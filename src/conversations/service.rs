use std::collections::HashSet;

use axum::http::StatusCode;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    conversations::types::{ConversationMember, ConversationSummary, CreateGroupRequest},
    error::{AppError, AppResult, ErrorCode},
    ids::new_uuid_v7,
    time::now_utc,
};

const GROUP_MEMBER_LIMIT: usize = 500;

#[derive(Debug, sqlx::FromRow)]
struct ConversationSummaryRow {
    conversation_id: Uuid,
    conversation_type: String,
    name: Option<String>,
    state: String,
    latest_message_seq: i64,
    read_seq: i64,
    unread_count: i64,
    active_member_count: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct ConversationRow {
    conversation_type: String,
    state: String,
    last_message_seq: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct MemberRow {
    user_id: Uuid,
    username: String,
    display_name: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct MemberStateRow {
    state: String,
}

impl From<ConversationSummaryRow> for ConversationSummary {
    fn from(row: ConversationSummaryRow) -> Self {
        Self {
            conversation_id: row.conversation_id,
            conversation_type: row.conversation_type,
            name: row.name,
            state: row.state,
            latest_message_seq: row.latest_message_seq,
            read_seq: row.read_seq,
            unread_count: row.unread_count,
            active_member_count: row.active_member_count,
        }
    }
}

impl From<MemberRow> for ConversationMember {
    fn from(row: MemberRow) -> Self {
        Self {
            user_id: row.user_id,
            username: row.username,
            display_name: row.display_name,
        }
    }
}

pub async fn list_conversations(
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<ConversationSummary>> {
    let rows = sqlx::query_as::<_, ConversationSummaryRow>(
        "select c.conversation_id,
                c.type as conversation_type,
                c.name,
                c.state,
                c.last_message_seq as latest_message_seq,
                cm.read_seq,
                greatest(c.last_message_seq - cm.read_seq, 0) as unread_count,
                (
                    select count(*)
                    from conversation_members active_cm
                    where active_cm.conversation_id = c.conversation_id
                      and active_cm.state = 'active'
                ) as active_member_count
         from conversation_members cm
         join conversations c on c.conversation_id = cm.conversation_id
         where cm.user_id = $1
           and cm.state = 'active'
           and c.state = 'active'
         order by c.last_message_at desc nulls last,
                  c.created_at desc,
                  c.conversation_id desc",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(internal_error)?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn create_group(
    pool: &PgPool,
    creator_user_id: Uuid,
    request: CreateGroupRequest,
) -> AppResult<ConversationSummary> {
    let name = normalize_group_name(request.name)?;
    let member_ids = normalize_group_member_ids(creator_user_id, request.member_ids)?;
    let other_member_ids = member_ids
        .iter()
        .copied()
        .filter(|member_id| *member_id != creator_user_id)
        .collect::<Vec<_>>();

    let mut tx = pool.begin().await.map_err(internal_error)?;
    ensure_users_exist(&mut tx, &other_member_ids).await?;

    let conversation_id = new_uuid_v7();
    let now = now_utc();

    sqlx::query(
        "insert into conversations (
             conversation_id, type, name, state, last_message_seq, created_by, created_at, updated_at
         ) values ($1, 'group', $2, 'active', 0, $3, $4, $4)",
    )
    .bind(conversation_id)
    .bind(&name)
    .bind(creator_user_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    for member_id in member_ids {
        sqlx::query(
            "insert into conversation_members (
                 conversation_id, user_id, state, read_seq, joined_at
             ) values ($1, $2, 'active', 0, $3)",
        )
        .bind(conversation_id)
        .bind(member_id)
        .bind(now)
        .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await
        .map_err(internal_error)?;
    }

    let summary =
        conversation_summary_for_user_tx(&mut tx, creator_user_id, conversation_id).await?;
    tx.commit().await.map_err(internal_error)?;

    Ok(summary)
}

pub async fn list_members(
    pool: &PgPool,
    requester_user_id: Uuid,
    conversation_id: Uuid,
) -> AppResult<Vec<ConversationMember>> {
    let conversation = get_conversation(pool, conversation_id).await?;
    ensure_group_conversation(&conversation)?;
    ensure_active_member_pool(pool, conversation_id, requester_user_id).await?;

    let rows = sqlx::query_as::<_, MemberRow>(
        "select u.user_id, u.username, u.display_name
         from conversation_members cm
         join users u on u.user_id = cm.user_id
         where cm.conversation_id = $1
           and cm.state = 'active'
         order by cm.joined_at asc, u.username asc",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
    .map_err(internal_error)?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn add_member(
    pool: &PgPool,
    requester_user_id: Uuid,
    conversation_id: Uuid,
    member_user_id: Uuid,
) -> AppResult<ConversationMember> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = lock_conversation(&mut tx, conversation_id).await?;
    ensure_group_conversation(&conversation)?;
    ensure_not_dissolved(&conversation)?;
    ensure_active_member_tx(&mut tx, conversation_id, requester_user_id).await?;
    let member = get_user_tx(&mut tx, member_user_id).await?;

    let existing_member = sqlx::query_as::<_, MemberStateRow>(
        "select state
         from conversation_members
         where conversation_id = $1 and user_id = $2
         for update",
    )
    .bind(conversation_id)
    .bind(member_user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal_error)?;

    match existing_member.as_ref().map(|row| row.state.as_str()) {
        Some("active") => {
            tx.commit().await.map_err(internal_error)?;
            return Ok(member.into());
        }
        Some("left") | None => {}
        Some(_) => return Err(internal_error_message("Invalid conversation member state")),
    }

    let active_member_count = active_member_count_tx(&mut tx, conversation_id).await?;
    if active_member_count >= GROUP_MEMBER_LIMIT as i64 {
        return Err(group_member_limit_exceeded());
    }

    let now = now_utc();
    let span_from_seq = match existing_member {
        Some(_) => {
            sqlx::query(
                "update conversation_members
                 set state = 'active', read_seq = $3, joined_at = $4, left_at = null
                 where conversation_id = $1 and user_id = $2",
            )
            .bind(conversation_id)
            .bind(member_user_id)
            .bind(conversation.last_message_seq)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(internal_error)?;
            conversation.last_message_seq + 1
        }
        None => {
            sqlx::query(
                "insert into conversation_members (
                     conversation_id, user_id, state, read_seq, joined_at
                 ) values ($1, $2, 'active', 0, $3)",
            )
            .bind(conversation_id)
            .bind(member_user_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(internal_error)?;
            1
        }
    };

    sqlx::query(
        "insert into conversation_member_spans (
             span_id, conversation_id, user_id, from_seq, created_at
         ) values ($1, $2, $3, $4, $5)",
    )
    .bind(new_uuid_v7())
    .bind(conversation_id)
    .bind(member_user_id)
    .bind(span_from_seq)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    sqlx::query("update conversations set updated_at = $2 where conversation_id = $1")
        .bind(conversation_id)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(internal_error)?;

    tx.commit().await.map_err(internal_error)?;
    Ok(member.into())
}

pub async fn leave_group(pool: &PgPool, user_id: Uuid, conversation_id: Uuid) -> AppResult<()> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = lock_conversation(&mut tx, conversation_id).await?;
    ensure_group_conversation(&conversation)?;
    ensure_not_dissolved(&conversation)?;
    ensure_active_member_tx(&mut tx, conversation_id, user_id).await?;

    let now = now_utc();

    sqlx::query(
        "update conversation_member_spans
         set to_seq = $3, closed_at = $4
         where conversation_id = $1
           and user_id = $2
           and to_seq is null",
    )
    .bind(conversation_id)
    .bind(user_id)
    .bind(conversation.last_message_seq)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    sqlx::query(
        "update conversation_members
         set state = 'left', left_at = $3
         where conversation_id = $1 and user_id = $2",
    )
    .bind(conversation_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    let remaining_active_members = active_member_count_tx(&mut tx, conversation_id).await?;
    if remaining_active_members == 0 {
        sqlx::query(
            "update conversations
             set state = 'dissolved', dissolved_at = $2, updated_at = $2
             where conversation_id = $1",
        )
        .bind(conversation_id)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(internal_error)?;
    } else {
        sqlx::query("update conversations set updated_at = $2 where conversation_id = $1")
            .bind(conversation_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(internal_error)?;
    }

    tx.commit().await.map_err(internal_error)?;
    Ok(())
}

fn normalize_group_name(name: String) -> AppResult<String> {
    let name = name.trim().to_string();
    let len = name.chars().count();
    if (1..=80).contains(&len) {
        Ok(name)
    } else {
        Err(AppError::unprocessable_request(
            "group name must be 1-80 characters",
        ))
    }
}

fn normalize_group_member_ids(
    creator_user_id: Uuid,
    requested_member_ids: Vec<Uuid>,
) -> AppResult<Vec<Uuid>> {
    let mut seen = HashSet::new();
    let mut member_ids = Vec::with_capacity(requested_member_ids.len() + 1);
    seen.insert(creator_user_id);
    member_ids.push(creator_user_id);

    for member_id in requested_member_ids {
        if seen.insert(member_id) {
            member_ids.push(member_id);
        }
    }

    if member_ids.len() < 2 {
        return Err(AppError::unprocessable_request(
            "group creation requires the creator and at least one other member",
        ));
    }

    if member_ids.len() > GROUP_MEMBER_LIMIT {
        return Err(group_member_limit_exceeded());
    }

    Ok(member_ids)
}

async fn ensure_users_exist(
    tx: &mut Transaction<'_, Postgres>,
    user_ids: &[Uuid],
) -> AppResult<()> {
    if user_ids.is_empty() {
        return Ok(());
    }

    let existing_count: i64 =
        sqlx::query_scalar("select count(*) from users where user_id = any($1)")
            .bind(user_ids)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal_error)?;

    if existing_count == user_ids.len() as i64 {
        Ok(())
    } else {
        Err(user_not_found())
    }
}

async fn get_user_tx(tx: &mut Transaction<'_, Postgres>, user_id: Uuid) -> AppResult<MemberRow> {
    sqlx::query_as::<_, MemberRow>(
        "select user_id, username, display_name from users where user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?
    .ok_or_else(user_not_found)
}

async fn get_conversation(pool: &PgPool, conversation_id: Uuid) -> AppResult<ConversationRow> {
    sqlx::query_as::<_, ConversationRow>(
        "select type as conversation_type, state, last_message_seq
         from conversations
         where conversation_id = $1",
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(conversation_not_found)
}

async fn lock_conversation(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> AppResult<ConversationRow> {
    sqlx::query_as::<_, ConversationRow>(
        "select type as conversation_type, state, last_message_seq
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

async fn conversation_summary_for_user_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    conversation_id: Uuid,
) -> AppResult<ConversationSummary> {
    let row = sqlx::query_as::<_, ConversationSummaryRow>(
        "select c.conversation_id,
                c.type as conversation_type,
                c.name,
                c.state,
                c.last_message_seq as latest_message_seq,
                cm.read_seq,
                greatest(c.last_message_seq - cm.read_seq, 0) as unread_count,
                (
                    select count(*)
                    from conversation_members active_cm
                    where active_cm.conversation_id = c.conversation_id
                      and active_cm.state = 'active'
                ) as active_member_count
         from conversation_members cm
         join conversations c on c.conversation_id = cm.conversation_id
         where cm.user_id = $1
           and cm.conversation_id = $2
           and cm.state = 'active'",
    )
    .bind(user_id)
    .bind(conversation_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(internal_error)?;

    Ok(row.into())
}

async fn ensure_active_member_pool(
    pool: &PgPool,
    conversation_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    let is_active: Option<i32> = sqlx::query_scalar(
        "select 1
         from conversation_members
         where conversation_id = $1
           and user_id = $2
           and state = 'active'",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?;

    if is_active.is_some() {
        Ok(())
    } else {
        Err(not_active_member())
    }
}

async fn ensure_active_member_tx(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    let is_active: Option<i32> = sqlx::query_scalar(
        "select 1
         from conversation_members
         where conversation_id = $1
           and user_id = $2
           and state = 'active'",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?;

    if is_active.is_some() {
        Ok(())
    } else {
        Err(not_active_member())
    }
}

async fn active_member_count_tx(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> AppResult<i64> {
    sqlx::query_scalar(
        "select count(*)
         from conversation_members
         where conversation_id = $1
           and state = 'active'",
    )
    .bind(conversation_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(internal_error)
}

fn ensure_group_conversation(conversation: &ConversationRow) -> AppResult<()> {
    if conversation.conversation_type == "group" {
        Ok(())
    } else {
        Err(AppError::invalid_request("conversation is not a group"))
    }
}

fn ensure_not_dissolved(conversation: &ConversationRow) -> AppResult<()> {
    if conversation.state == "dissolved" {
        Err(AppError::new(
            StatusCode::CONFLICT,
            ErrorCode::ConversationDissolved,
            "Conversation is dissolved",
        ))
    } else {
        Ok(())
    }
}

fn conversation_not_found() -> AppError {
    AppError::new(
        StatusCode::NOT_FOUND,
        ErrorCode::ConversationNotFound,
        "Conversation was not found",
    )
}

fn not_active_member() -> AppError {
    AppError::new(
        StatusCode::FORBIDDEN,
        ErrorCode::NotActiveMember,
        "User is not an active conversation member",
    )
}

fn group_member_limit_exceeded() -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::GroupMemberLimitExceeded,
        "Group active member limit exceeded",
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
    tracing::error!(message, "conversation invariant failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}
