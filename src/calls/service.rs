use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    auth::types::CurrentUser,
    error::{AppError, AppResult, ErrorCode},
    ids::{UserId, new_uuid_v7},
    messages::service as messages_service,
    realtime::connection_registry::ConnectionRegistry,
    time::now_utc,
    users::types::UserSummary,
};

use super::types::{CallCommandResult, CallEndReason, CallMediaType, CallState, CallSummary};

#[derive(Debug, sqlx::FromRow)]
struct ConversationKindRow {
    conversation_type: String,
    state: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ConversationMemberRow {
    user_id: UserId,
    username: String,
    display_name: Option<String>,
}

#[derive(Debug)]
struct DirectCallParticipants {
    caller: UserSummary,
    callee: UserSummary,
}

#[derive(Debug, sqlx::FromRow)]
struct CallSummaryRow {
    call_id: Uuid,
    conversation_id: Uuid,
    caller_user_id: UserId,
    caller_username: String,
    caller_display_name: Option<String>,
    callee_user_id: UserId,
    callee_username: String,
    callee_display_name: Option<String>,
    caller_client_id: Uuid,
    accepted_client_id: Option<Uuid>,
    media_type: String,
    state: String,
    started_at: DateTime<Utc>,
    accepted_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    end_reason: Option<String>,
}

pub async fn invite(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    caller: CurrentUser,
    conversation_id: Uuid,
    media_type: CallMediaType,
) -> AppResult<CallCommandResult> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = messages_service::lock_conversation(&mut tx, conversation_id).await?;
    ensure_active_direct_conversation(&mut tx, conversation_id).await?;
    let participants = load_direct_participants(&mut tx, conversation_id, caller.user_id).await?;

    if !registry.is_user_online(participants.callee.user_id) {
        insert_ended_call_attempt_in_locked_conversation(
            &mut tx,
            &conversation,
            &caller,
            &participants,
            new_uuid_v7(),
            conversation_id,
            media_type,
            CallEndReason::Offline,
            now_utc(),
        )
        .await?;
        tx.commit().await.map_err(internal_error)?;
        return Err(callee_offline());
    }

    let call_id = new_uuid_v7();
    let now = now_utc();
    insert_call_session(
        &mut tx,
        call_id,
        conversation_id,
        &caller,
        participants.callee.user_id,
        media_type,
        now,
        "ringing",
        None,
    )
    .await?;

    if let Err(error) = insert_call_participant(
        &mut tx,
        call_id,
        participants.caller.user_id,
        "caller",
        "ringing",
    )
    .await
    {
        let is_busy = is_unique_violation(&error);
        tx.rollback().await.map_err(internal_error)?;
        if is_busy {
            return Err(call_busy());
        }
        return Err(internal_error(error));
    }

    if let Err(error) = insert_call_participant(
        &mut tx,
        call_id,
        participants.callee.user_id,
        "callee",
        "ringing",
    )
    .await
    {
        let is_busy = is_unique_violation(&error);
        tx.rollback().await.map_err(internal_error)?;
        if is_busy {
            insert_ended_call_attempt(
                pool,
                &caller,
                &participants,
                call_id,
                conversation_id,
                media_type,
                CallEndReason::Busy,
            )
            .await?;
            return Err(call_busy());
        }
        return Err(internal_error(error));
    }

    let call = call_summary_by_id(&mut tx, call_id).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(CallCommandResult { call })
}

pub(crate) async fn call_summary_by_id(
    tx: &mut Transaction<'_, Postgres>,
    call_id: Uuid,
) -> AppResult<CallSummary> {
    let row = sqlx::query_as::<_, CallSummaryRow>(
        "select cs.call_id,
                cs.conversation_id,
                caller.user_id as caller_user_id,
                caller.username as caller_username,
                caller.display_name as caller_display_name,
                callee.user_id as callee_user_id,
                callee.username as callee_username,
                callee.display_name as callee_display_name,
                cs.caller_client_id,
                cs.accepted_client_id,
                cs.media_type,
                cs.state,
                cs.started_at,
                cs.accepted_at,
                cs.ended_at,
                cs.end_reason
         from call_sessions cs
         join users caller on caller.user_id = cs.caller_user_id
         join users callee on callee.user_id = cs.callee_user_id
         where cs.call_id = $1",
    )
    .bind(call_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?
    .ok_or_else(call_not_found)?;

    row.into_summary()
}

async fn insert_ended_call_attempt(
    pool: &PgPool,
    caller: &CurrentUser,
    participants: &DirectCallParticipants,
    call_id: Uuid,
    conversation_id: Uuid,
    media_type: CallMediaType,
    reason: CallEndReason,
) -> AppResult<()> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = messages_service::lock_conversation(&mut tx, conversation_id).await?;
    insert_ended_call_attempt_in_locked_conversation(
        &mut tx,
        &conversation,
        caller,
        participants,
        call_id,
        conversation_id,
        media_type,
        reason,
        now_utc(),
    )
    .await?;
    tx.commit().await.map_err(internal_error)
}

async fn insert_ended_call_attempt_in_locked_conversation(
    tx: &mut Transaction<'_, Postgres>,
    conversation: &messages_service::ConversationRow,
    caller: &CurrentUser,
    participants: &DirectCallParticipants,
    call_id: Uuid,
    conversation_id: Uuid,
    media_type: CallMediaType,
    reason: CallEndReason,
    now: DateTime<Utc>,
) -> AppResult<()> {
    insert_call_session(
        tx,
        call_id,
        conversation_id,
        caller,
        participants.callee.user_id,
        media_type,
        now,
        "ended",
        Some(reason),
    )
    .await?;
    insert_call_participant(tx, call_id, participants.caller.user_id, "caller", "ended")
        .await
        .map_err(internal_error)?;
    insert_call_participant(tx, call_id, participants.callee.user_id, "callee", "ended")
        .await
        .map_err(internal_error)?;

    let message = messages_service::insert_call_event_message_in_locked_conversation(
        tx,
        conversation,
        caller,
        ended_attempt_body(media_type, reason),
        json!({
            "call_id": call_id,
            "media_type": media_type.as_str(),
            "outcome": reason.as_str(),
            "duration_seconds": 0,
            "caller_user_id": participants.caller.user_id,
            "callee_user_id": participants.callee.user_id,
        }),
    )
    .await?;

    sqlx::query("update call_sessions set created_message_id = $2 where call_id = $1")
        .bind(call_id)
        .bind(message.message.message_id)
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;

    Ok(())
}

async fn ensure_active_direct_conversation(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> AppResult<()> {
    let row = sqlx::query_as::<_, ConversationKindRow>(
        "select type as conversation_type, state
         from conversations
         where conversation_id = $1",
    )
    .bind(conversation_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(internal_error)?;

    if row.conversation_type == "direct" && row.state == "active" {
        Ok(())
    } else {
        Err(AppError::invalid_request(
            "Calls require an active direct conversation",
        ))
    }
}

async fn load_direct_participants(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    caller_user_id: UserId,
) -> AppResult<DirectCallParticipants> {
    let rows = sqlx::query_as::<_, ConversationMemberRow>(
        "select u.user_id, u.username, u.display_name
         from conversation_members cm
         join users u on u.user_id = cm.user_id
         where cm.conversation_id = $1
           and cm.state = 'active'
         order by u.user_id",
    )
    .bind(conversation_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(internal_error)?;

    if rows.len() != 2 {
        return Err(AppError::invalid_request(
            "Direct calls require exactly two active conversation members",
        ));
    }

    let mut caller = None;
    let mut callee = None;
    for row in rows {
        let summary = UserSummary {
            user_id: row.user_id,
            username: row.username,
            display_name: row.display_name,
        };
        if summary.user_id == caller_user_id {
            caller = Some(summary);
        } else {
            callee = Some(summary);
        }
    }

    let Some(caller) = caller else {
        return Err(not_conversation_member());
    };
    let Some(callee) = callee else {
        return Err(AppError::invalid_request(
            "Direct calls require a distinct callee",
        ));
    };

    Ok(DirectCallParticipants { caller, callee })
}

async fn insert_call_session(
    tx: &mut Transaction<'_, Postgres>,
    call_id: Uuid,
    conversation_id: Uuid,
    caller: &CurrentUser,
    callee_user_id: UserId,
    media_type: CallMediaType,
    now: DateTime<Utc>,
    state: &'static str,
    end_reason: Option<CallEndReason>,
) -> AppResult<()> {
    sqlx::query(
        "insert into call_sessions (
             call_id, conversation_id, caller_user_id, callee_user_id, caller_client_id,
             media_type, state, started_at, ended_at, end_reason
         ) values ($1, $2, $3, $4, $5, $6, $7, $8,
             case when $7 = 'ended' then $8 else null end,
             $9
         )",
    )
    .bind(call_id)
    .bind(conversation_id)
    .bind(caller.user_id)
    .bind(callee_user_id)
    .bind(caller.client_id)
    .bind(media_type.as_str())
    .bind(state)
    .bind(now)
    .bind(end_reason.map(CallEndReason::as_str))
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    Ok(())
}

async fn insert_call_participant(
    tx: &mut Transaction<'_, Postgres>,
    call_id: Uuid,
    user_id: UserId,
    role: &'static str,
    state: &'static str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into call_participants (call_id, user_id, role, state)
         values ($1, $2, $3, $4)",
    )
    .bind(call_id)
    .bind(user_id)
    .bind(role)
    .bind(state)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

impl CallSummaryRow {
    fn into_summary(self) -> AppResult<CallSummary> {
        let media_type = parse_media_type(&self.media_type)?;
        let state = parse_call_state(&self.state)?;
        let end_reason = self
            .end_reason
            .as_deref()
            .map(parse_end_reason)
            .transpose()?;

        Ok(CallSummary {
            call_id: self.call_id,
            conversation_id: self.conversation_id,
            caller: UserSummary {
                user_id: self.caller_user_id,
                username: self.caller_username,
                display_name: self.caller_display_name,
            },
            callee: UserSummary {
                user_id: self.callee_user_id,
                username: self.callee_username,
                display_name: self.callee_display_name,
            },
            caller_client_id: self.caller_client_id,
            accepted_client_id: self.accepted_client_id,
            media_type,
            state,
            started_at: self.started_at,
            accepted_at: self.accepted_at,
            ended_at: self.ended_at,
            end_reason,
        })
    }
}

fn parse_media_type(value: &str) -> AppResult<CallMediaType> {
    match value {
        "audio" => Ok(CallMediaType::Audio),
        "video" => Ok(CallMediaType::Video),
        _ => Err(internal_error_message("invalid call media type")),
    }
}

fn parse_call_state(value: &str) -> AppResult<CallState> {
    match value {
        "ringing" => Ok(CallState::Ringing),
        "connecting" => Ok(CallState::Connecting),
        "active" => Ok(CallState::Active),
        "ended" => Ok(CallState::Ended),
        _ => Err(internal_error_message("invalid call state")),
    }
}

fn parse_end_reason(value: &str) -> AppResult<CallEndReason> {
    match value {
        "completed" => Ok(CallEndReason::Completed),
        "rejected" => Ok(CallEndReason::Rejected),
        "canceled" => Ok(CallEndReason::Canceled),
        "timeout" => Ok(CallEndReason::Timeout),
        "busy" => Ok(CallEndReason::Busy),
        "offline" => Ok(CallEndReason::Offline),
        "network_error" => Ok(CallEndReason::NetworkError),
        _ => Err(internal_error_message("invalid call end reason")),
    }
}

fn ended_attempt_body(media_type: CallMediaType, reason: CallEndReason) -> String {
    let media = match media_type {
        CallMediaType::Audio => "语音通话",
        CallMediaType::Video => "视频通话",
    };
    match reason {
        CallEndReason::Offline => format!("{media} 对方离线"),
        CallEndReason::Busy => format!("{media} 忙线未接通"),
        _ => format!("{media} 未接通"),
    }
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|db_error| db_error.code().as_deref() == Some("23505"))
}

fn call_busy() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        ErrorCode::CallBusy,
        "User is already in a call",
    )
}

fn callee_offline() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        ErrorCode::CalleeOffline,
        "Callee is offline",
    )
}

fn call_not_found() -> AppError {
    AppError::new(
        StatusCode::NOT_FOUND,
        ErrorCode::CallNotFound,
        "Call was not found",
    )
}

fn not_conversation_member() -> AppError {
    AppError::new(
        StatusCode::FORBIDDEN,
        ErrorCode::NotConversationMember,
        "User is not a conversation member",
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
    tracing::error!(message, "call invariant failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}
