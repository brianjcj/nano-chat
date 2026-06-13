use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    auth::types::CurrentUser,
    error::{AppError, AppResult, ErrorCode},
    ids::new_uuid_v7,
    messages::types::{DirectTarget, MessageCursor, MessageDto, SendMessageResult},
    time::now_utc,
    users::types::UserSummary,
};

const DEFAULT_MAX_MESSAGE_BYTES: usize = 4096;
const MAX_CLIENT_MSG_ID_CHARS: usize = 100;
const MAX_HISTORY_LIMIT: i64 = 100;

#[derive(Debug, Clone)]
struct ValidatedMessageInput {
    client_msg_id: String,
    body: String,
    body_hash: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ConversationRow {
    conversation_id: Uuid,
    conversation_type: String,
    state: String,
    last_message_seq: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct TargetUserRow {
    user_id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
struct MemberStateRow {
    state: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ExistingMessageRow {
    message_id: Uuid,
    request_fingerprint: String,
}

#[derive(Debug, sqlx::FromRow)]
struct MessageDtoRow {
    message_id: Uuid,
    conversation_id: Uuid,
    message_seq: i64,
    sender_user_id: Uuid,
    sender_username: String,
    sender_display_name: Option<String>,
    body: String,
    created_at: DateTime<Utc>,
}

impl From<MessageDtoRow> for MessageDto {
    fn from(row: MessageDtoRow) -> Self {
        Self {
            message_id: row.message_id,
            conversation_id: row.conversation_id,
            message_seq: row.message_seq,
            sender: UserSummary {
                user_id: row.sender_user_id,
                username: row.sender_username,
                display_name: row.sender_display_name,
            },
            body: row.body,
            created_at: row.created_at,
        }
    }
}

pub async fn send_message(
    pool: &PgPool,
    sender: CurrentUser,
    conversation_id: Uuid,
    client_msg_id: String,
    body: String,
) -> AppResult<SendMessageResult> {
    let input = validate_message_input(client_msg_id, body)?;
    let mut tx = pool.begin().await.map_err(internal_error)?;

    let conversation = lock_conversation(&mut tx, conversation_id).await?;
    ensure_can_send(&mut tx, &conversation, sender.user_id).await?;
    let result =
        send_message_in_locked_conversation(&mut tx, &sender, &conversation, input).await?;

    tx.commit().await.map_err(internal_error)?;
    Ok(result)
}

pub async fn send_direct_message(
    pool: &PgPool,
    sender: CurrentUser,
    target: DirectTarget,
    client_msg_id: String,
    body: String,
) -> AppResult<SendMessageResult> {
    let input = validate_message_input(client_msg_id, body)?;
    let mut tx = pool.begin().await.map_err(internal_error)?;

    let target_user = resolve_direct_target(&mut tx, target).await?;
    if target_user.user_id == sender.user_id {
        return Err(AppError::invalid_request(
            "direct message target must be another user",
        ));
    }

    let (user_low, user_high) = ordered_user_pair(sender.user_id, target_user.user_id);
    lock_direct_pair(&mut tx, user_low, user_high).await?;

    let conversation = match find_direct_conversation(&mut tx, user_low, user_high).await? {
        Some(conversation) => conversation,
        None => create_direct_conversation(&mut tx, sender.user_id, target_user.user_id).await?,
    };

    ensure_can_send(&mut tx, &conversation, sender.user_id).await?;
    let result =
        send_message_in_locked_conversation(&mut tx, &sender, &conversation, input).await?;

    tx.commit().await.map_err(internal_error)?;
    Ok(result)
}

pub async fn list_messages(
    pool: &PgPool,
    viewer: CurrentUser,
    conversation_id: Uuid,
    cursor: MessageCursor,
) -> AppResult<Vec<MessageDto>> {
    let limit = normalize_history_limit(cursor.limit)?;
    validate_cursor_seq(cursor.after_seq, "after_seq")?;
    validate_cursor_seq(cursor.before_seq, "before_seq")?;

    ensure_conversation_exists(pool, conversation_id).await?;
    ensure_has_visibility_span(pool, conversation_id, viewer.user_id).await?;

    let before_only = cursor.before_seq.is_some() && cursor.after_seq.is_none();
    let order_direction = if before_only { "desc" } else { "asc" };
    let sql = format!(
        "select m.message_id,
                m.conversation_id,
                m.message_seq,
                u.user_id as sender_user_id,
                u.username as sender_username,
                u.display_name as sender_display_name,
                m.body,
                m.created_at
         from messages m
         join users u on u.user_id = m.sender_user_id
         where m.conversation_id = $1
           and ($3::bigint is null or m.message_seq > $3)
           and ($4::bigint is null or m.message_seq < $4)
           and exists (
               select 1
               from conversation_member_spans cms
               where cms.conversation_id = m.conversation_id
                 and cms.user_id = $2
                 and cms.from_seq <= m.message_seq
                 and (cms.to_seq is null or m.message_seq <= cms.to_seq)
           )
         order by m.message_seq {order_direction}
         limit $5"
    );

    let mut rows = sqlx::query_as::<_, MessageDtoRow>(&sql)
        .bind(conversation_id)
        .bind(viewer.user_id)
        .bind(cursor.after_seq)
        .bind(cursor.before_seq)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(internal_error)?;

    if before_only {
        rows.reverse();
    }

    Ok(rows.into_iter().map(Into::into).collect())
}

async fn send_message_in_locked_conversation(
    tx: &mut Transaction<'_, Postgres>,
    sender: &CurrentUser,
    conversation: &ConversationRow,
    input: ValidatedMessageInput,
) -> AppResult<SendMessageResult> {
    let request_fingerprint = request_fingerprint(conversation.conversation_id, &input.body_hash);

    if let Some(existing) = find_existing_message(tx, sender, &input.client_msg_id).await? {
        return existing_message_result(tx, existing, &request_fingerprint).await;
    }

    let message_id = new_uuid_v7();
    let message_seq = conversation.last_message_seq + 1;
    let now = now_utc();

    let inserted_message_id = sqlx::query_scalar::<_, Uuid>(
        "insert into messages (
             message_id, conversation_id, message_seq, sender_user_id, client_id,
             client_msg_id, body, body_hash, request_fingerprint, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (sender_user_id, client_id, client_msg_id) do nothing
         returning message_id",
    )
    .bind(message_id)
    .bind(conversation.conversation_id)
    .bind(message_seq)
    .bind(sender.user_id)
    .bind(sender.client_id)
    .bind(&input.client_msg_id)
    .bind(&input.body)
    .bind(&input.body_hash)
    .bind(&request_fingerprint)
    .bind(now)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?;

    let Some(inserted_message_id) = inserted_message_id else {
        let existing = find_existing_message(tx, sender, &input.client_msg_id)
            .await?
            .ok_or_else(|| internal_error_message("idempotency conflict row was not visible"))?;
        return existing_message_result(tx, existing, &request_fingerprint).await;
    };

    sqlx::query(
        "update conversations
         set last_message_seq = $2,
             last_message_id = $3,
             last_message_at = $4,
             updated_at = $4
         where conversation_id = $1",
    )
    .bind(conversation.conversation_id)
    .bind(message_seq)
    .bind(inserted_message_id)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    sqlx::query(
        "update conversation_members
         set read_seq = greatest(read_seq, $3)
         where conversation_id = $1 and user_id = $2",
    )
    .bind(conversation.conversation_id)
    .bind(sender.user_id)
    .bind(message_seq)
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    let message = message_dto_by_id(tx, inserted_message_id).await?;
    Ok(SendMessageResult {
        conversation_id: message.conversation_id,
        message,
    })
}

async fn existing_message_result(
    tx: &mut Transaction<'_, Postgres>,
    existing: ExistingMessageRow,
    request_fingerprint: &str,
) -> AppResult<SendMessageResult> {
    if existing.request_fingerprint != request_fingerprint {
        return Err(idempotency_conflict());
    }

    let message = message_dto_by_id(tx, existing.message_id).await?;
    Ok(SendMessageResult {
        conversation_id: message.conversation_id,
        message,
    })
}

async fn find_existing_message(
    tx: &mut Transaction<'_, Postgres>,
    sender: &CurrentUser,
    client_msg_id: &str,
) -> AppResult<Option<ExistingMessageRow>> {
    sqlx::query_as::<_, ExistingMessageRow>(
        "select message_id, request_fingerprint
         from messages
         where sender_user_id = $1
           and client_id = $2
           and client_msg_id = $3",
    )
    .bind(sender.user_id)
    .bind(sender.client_id)
    .bind(client_msg_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)
}

async fn message_dto_by_id(
    tx: &mut Transaction<'_, Postgres>,
    message_id: Uuid,
) -> AppResult<MessageDto> {
    let row = sqlx::query_as::<_, MessageDtoRow>(
        "select m.message_id,
                m.conversation_id,
                m.message_seq,
                u.user_id as sender_user_id,
                u.username as sender_username,
                u.display_name as sender_display_name,
                m.body,
                m.created_at
         from messages m
         join users u on u.user_id = m.sender_user_id
         where m.message_id = $1",
    )
    .bind(message_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?
    .ok_or_else(message_not_found)?;

    Ok(row.into())
}

async fn lock_conversation(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> AppResult<ConversationRow> {
    sqlx::query_as::<_, ConversationRow>(
        "select conversation_id, type as conversation_type, state, last_message_seq
         from conversations
         where conversation_id = $1
         for update",
    )
    .bind(conversation_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?
    .ok_or_else(conversation_not_found)
}

async fn find_direct_conversation(
    tx: &mut Transaction<'_, Postgres>,
    user_low: Uuid,
    user_high: Uuid,
) -> AppResult<Option<ConversationRow>> {
    sqlx::query_as::<_, ConversationRow>(
        "select c.conversation_id, c.type as conversation_type, c.state, c.last_message_seq
         from direct_conversation_pairs dcp
         join conversations c on c.conversation_id = dcp.conversation_id
         where dcp.user_low = $1 and dcp.user_high = $2
         for update of c",
    )
    .bind(user_low)
    .bind(user_high)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)
}

async fn create_direct_conversation(
    tx: &mut Transaction<'_, Postgres>,
    sender_user_id: Uuid,
    target_user_id: Uuid,
) -> AppResult<ConversationRow> {
    let conversation_id = new_uuid_v7();
    let now = now_utc();
    let (user_low, user_high) = ordered_user_pair(sender_user_id, target_user_id);

    sqlx::query(
        "insert into conversations (
             conversation_id, type, name, state, last_message_seq, created_by, created_at, updated_at
         ) values ($1, 'direct', null, 'active', 0, $2, $3, $3)",
    )
    .bind(conversation_id)
    .bind(sender_user_id)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    sqlx::query(
        "insert into direct_conversation_pairs (conversation_id, user_low, user_high)
         values ($1, $2, $3)",
    )
    .bind(conversation_id)
    .bind(user_low)
    .bind(user_high)
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    for member_id in [sender_user_id, target_user_id] {
        sqlx::query(
            "insert into conversation_members (
                 conversation_id, user_id, state, read_seq, joined_at
             ) values ($1, $2, 'active', 0, $3)",
        )
        .bind(conversation_id)
        .bind(member_id)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;

        sqlx::query(
            "insert into conversation_member_spans (
                 span_id, conversation_id, user_id, from_seq, created_at
             ) values ($1, $2, $3, 1, $4)",
        )
        .bind(new_uuid_v7())
        .bind(conversation_id)
        .bind(member_id)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;
    }

    Ok(ConversationRow {
        conversation_id,
        conversation_type: "direct".to_string(),
        state: "active".to_string(),
        last_message_seq: 0,
    })
}

async fn resolve_direct_target(
    tx: &mut Transaction<'_, Postgres>,
    target: DirectTarget,
) -> AppResult<TargetUserRow> {
    match target {
        DirectTarget::Username(username) => {
            let username = username.to_ascii_lowercase();
            sqlx::query_as::<_, TargetUserRow>("select user_id from users where username = $1")
                .bind(username)
                .fetch_optional(&mut **tx)
                .await
                .map_err(internal_error)?
                .ok_or_else(user_not_found)
        }
        DirectTarget::UserId(user_id) => {
            sqlx::query_as::<_, TargetUserRow>("select user_id from users where user_id = $1")
                .bind(user_id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(internal_error)?
                .ok_or_else(user_not_found)
        }
    }
}

async fn lock_direct_pair(
    tx: &mut Transaction<'_, Postgres>,
    user_low: Uuid,
    user_high: Uuid,
) -> AppResult<()> {
    let pair_key = format!("direct:{user_low}:{user_high}");
    sqlx::query("select pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(pair_key)
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;
    Ok(())
}

async fn ensure_can_send(
    tx: &mut Transaction<'_, Postgres>,
    conversation: &ConversationRow,
    user_id: Uuid,
) -> AppResult<()> {
    if conversation.state == "dissolved" {
        return Err(conversation_dissolved());
    }

    let member = sqlx::query_as::<_, MemberStateRow>(
        "select state
         from conversation_members
         where conversation_id = $1 and user_id = $2",
    )
    .bind(conversation.conversation_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?;

    match conversation.conversation_type.as_str() {
        "direct" => match member.as_ref().map(|row| row.state.as_str()) {
            Some("active") => Ok(()),
            Some(_) | None => Err(not_conversation_member()),
        },
        "group" => match member.as_ref().map(|row| row.state.as_str()) {
            Some("active") => Ok(()),
            Some(_) | None => Err(not_active_member()),
        },
        _ => Err(internal_error_message("invalid conversation type")),
    }
}

async fn ensure_conversation_exists(pool: &PgPool, conversation_id: Uuid) -> AppResult<()> {
    let exists: Option<i32> =
        sqlx::query_scalar("select 1 from conversations where conversation_id = $1")
            .bind(conversation_id)
            .fetch_optional(pool)
            .await
            .map_err(internal_error)?;

    if exists.is_some() {
        Ok(())
    } else {
        Err(conversation_not_found())
    }
}

async fn ensure_has_visibility_span(
    pool: &PgPool,
    conversation_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    let exists: Option<i32> = sqlx::query_scalar(
        "select 1
         from conversation_member_spans
         where conversation_id = $1 and user_id = $2
         limit 1",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?;

    if exists.is_some() {
        Ok(())
    } else {
        Err(not_conversation_member())
    }
}

fn validate_message_input(client_msg_id: String, body: String) -> AppResult<ValidatedMessageInput> {
    let client_msg_id_len = client_msg_id.chars().count();
    if !(1..=MAX_CLIENT_MSG_ID_CHARS).contains(&client_msg_id_len) {
        return Err(AppError::invalid_request(
            "client_msg_id must be 1-100 characters",
        ));
    }

    if body.trim().is_empty() {
        return Err(empty_message());
    }

    if body.len() > DEFAULT_MAX_MESSAGE_BYTES {
        return Err(message_too_large());
    }

    let body_hash = sha256_hex(body.as_bytes());
    Ok(ValidatedMessageInput {
        client_msg_id,
        body,
        body_hash,
    })
}

fn normalize_history_limit(limit: i64) -> AppResult<i64> {
    if limit <= 0 {
        return Err(AppError::invalid_request("limit must be greater than 0"));
    }

    Ok(limit.min(MAX_HISTORY_LIMIT))
}

fn validate_cursor_seq(value: Option<i64>, name: &'static str) -> AppResult<()> {
    if value.is_some_and(|seq| seq < 0) {
        Err(AppError::invalid_request(format!(
            "{name} must be greater than or equal to 0"
        )))
    } else {
        Ok(())
    }
}

fn request_fingerprint(conversation_id: Uuid, body_hash: &str) -> String {
    sha256_hex(format!("v1|conversation:{conversation_id}|body:{body_hash}").as_bytes())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn ordered_user_pair(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b { (a, b) } else { (b, a) }
}

fn conversation_not_found() -> AppError {
    AppError::new(
        StatusCode::NOT_FOUND,
        ErrorCode::ConversationNotFound,
        "Conversation was not found",
    )
}

fn message_not_found() -> AppError {
    AppError::new(
        StatusCode::NOT_FOUND,
        ErrorCode::MessageNotFound,
        "Message was not found",
    )
}

fn not_conversation_member() -> AppError {
    AppError::new(
        StatusCode::FORBIDDEN,
        ErrorCode::NotConversationMember,
        "User is not a conversation member",
    )
}

fn not_active_member() -> AppError {
    AppError::new(
        StatusCode::FORBIDDEN,
        ErrorCode::NotActiveMember,
        "User is not an active conversation member",
    )
}

fn conversation_dissolved() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        ErrorCode::ConversationDissolved,
        "Conversation is dissolved",
    )
}

fn empty_message() -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::EmptyMessage,
        "Message body must not be empty",
    )
}

fn message_too_large() -> AppError {
    AppError::new(
        StatusCode::PAYLOAD_TOO_LARGE,
        ErrorCode::MessageTooLarge,
        "Message body exceeds the maximum size",
    )
}

fn idempotency_conflict() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        ErrorCode::IdempotencyConflict,
        "client_msg_id has already been used for a different message request",
    )
}

fn user_not_found() -> AppError {
    AppError::new(
        StatusCode::NOT_FOUND,
        ErrorCode::UserNotFound,
        "User was not found",
    )
}

fn internal_error(error: sqlx::Error) -> AppError {
    tracing::error!(%error, "database operation failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}

fn internal_error_message(message: &'static str) -> AppError {
    tracing::error!(message, "message invariant failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}
