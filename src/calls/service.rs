use axum::http::StatusCode;
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    auth::types::CurrentUser,
    error::{AppError, AppResult, ErrorCode},
    ids::{UserId, new_uuid_v7},
    messages::{service as messages_service, types::MessageDto},
    realtime::connection_registry::ConnectionRegistry,
    time::now_utc,
    users::types::UserSummary,
};

use super::types::{
    CallCommandResult, CallEndReason, CallInviteOutcome, CallMediaType, CallSignalTarget,
    CallState, CallSummary,
};

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

#[derive(Debug, sqlx::FromRow)]
struct LockedCallSessionRow {
    call_id: Uuid,
    conversation_id: Uuid,
    caller_user_id: UserId,
    callee_user_id: UserId,
    caller_client_id: Uuid,
    accepted_client_id: Option<Uuid>,
    media_type: String,
    state: String,
    started_at: DateTime<Utc>,
    accepted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct SignalTargetCallRow {
    caller_user_id: UserId,
    callee_user_id: UserId,
    caller_client_id: Uuid,
    accepted_client_id: Option<Uuid>,
    state: String,
}

#[derive(Debug, sqlx::FromRow)]
struct InterruptedCallRow {
    call_id: Uuid,
    caller_user_id: UserId,
    callee_user_id: UserId,
    caller_client_id: Uuid,
    accepted_client_id: Option<Uuid>,
    interruption_detected_at: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct CallActorRow {
    username: String,
    display_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequiredCallRole {
    Caller,
    Callee,
    Participant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequiredCallClient {
    AnyClientForRole,
    SelectedClient,
}

pub async fn invite(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    caller: CurrentUser,
    conversation_id: Uuid,
    media_type: CallMediaType,
) -> AppResult<CallCommandResult> {
    match invite_with_outcome(pool, registry, caller, conversation_id, media_type).await? {
        CallInviteOutcome::Started(result) => Ok(result),
        CallInviteOutcome::Busy(_) => Err(call_busy()),
        CallInviteOutcome::Offline(_) => Err(callee_offline()),
    }
}

pub async fn invite_with_outcome(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    caller: CurrentUser,
    conversation_id: Uuid,
    media_type: CallMediaType,
) -> AppResult<CallInviteOutcome> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = messages_service::lock_conversation(&mut tx, conversation_id).await?;
    ensure_active_direct_conversation(&mut tx, conversation_id).await?;
    let participants = load_direct_participants(&mut tx, conversation_id, caller.user_id).await?;

    if !registry.is_user_online(participants.callee.user_id) {
        let call_id = new_uuid_v7();
        let call_event_message = insert_ended_call_attempt_in_locked_conversation(
            &mut tx,
            &conversation,
            &caller,
            &participants,
            call_id,
            conversation_id,
            media_type,
            CallEndReason::Offline,
            now_utc(),
        )
        .await?;
        let call = call_summary_by_id(&mut tx, call_id).await?;
        tx.commit().await.map_err(internal_error)?;
        return Ok(CallInviteOutcome::Offline(
            CallCommandResult::with_call_event_message(call, call_event_message),
        ));
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
            let busy = insert_ended_call_attempt(
                pool,
                &caller,
                &participants,
                call_id,
                conversation_id,
                media_type,
                CallEndReason::Busy,
            )
            .await?;
            return Ok(CallInviteOutcome::Busy(busy));
        }
        return Err(internal_error(error));
    }

    let call = call_summary_by_id(&mut tx, call_id).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(CallInviteOutcome::Started(
        CallCommandResult::without_call_event_message(call),
    ))
}

pub async fn accept(
    pool: &PgPool,
    callee: CurrentUser,
    call_id: Uuid,
) -> AppResult<CallCommandResult> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let call = lock_call_session(&mut tx, call_id).await?;
    ensure_required_role(&call, callee.user_id, RequiredCallRole::Callee)?;
    ensure_call_state(&call, &[CallState::Ringing])?;

    let now = now_utc();
    sqlx::query(
        "update call_sessions
         set state = $2,
             accepted_at = $3,
             accepted_client_id = $4
         where call_id = $1",
    )
    .bind(call_id)
    .bind(CallState::Connecting.as_str())
    .bind(now)
    .bind(callee.client_id)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    update_call_participants_state(&mut tx, call_id, CallState::Connecting).await?;
    let call = call_summary_by_id(&mut tx, call_id).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(CallCommandResult::without_call_event_message(call))
}

pub async fn connected(
    pool: &PgPool,
    participant: CurrentUser,
    call_id: Uuid,
) -> AppResult<CallCommandResult> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let call = lock_call_session(&mut tx, call_id).await?;
    ensure_required_role(&call, participant.user_id, RequiredCallRole::Participant)?;
    ensure_selected_call_client(&call, &participant)?;
    let current_state = call_state(&call)?;
    if current_state == CallState::Active {
        let call = call_summary_by_id(&mut tx, call_id).await?;
        tx.commit().await.map_err(internal_error)?;
        return Ok(CallCommandResult::without_call_event_message(call));
    }
    ensure_call_state(&call, &[CallState::Connecting])?;

    sqlx::query(
        "update call_sessions
         set state = $2
         where call_id = $1",
    )
    .bind(call_id)
    .bind(CallState::Active.as_str())
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    update_call_participants_state(&mut tx, call_id, CallState::Active).await?;
    let call = call_summary_by_id(&mut tx, call_id).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(CallCommandResult::without_call_event_message(call))
}

pub async fn reject(
    pool: &PgPool,
    callee: CurrentUser,
    call_id: Uuid,
) -> AppResult<CallCommandResult> {
    end_call(
        pool,
        callee,
        call_id,
        CallEndReason::Rejected,
        RequiredCallRole::Callee,
        RequiredCallClient::AnyClientForRole,
        &[CallState::Ringing],
    )
    .await
}

pub async fn cancel(
    pool: &PgPool,
    caller: CurrentUser,
    call_id: Uuid,
) -> AppResult<CallCommandResult> {
    end_call(
        pool,
        caller,
        call_id,
        CallEndReason::Canceled,
        RequiredCallRole::Caller,
        RequiredCallClient::SelectedClient,
        &[CallState::Ringing],
    )
    .await
}

pub async fn hangup(
    pool: &PgPool,
    participant: CurrentUser,
    call_id: Uuid,
    reason: CallEndReason,
) -> AppResult<CallCommandResult> {
    if !matches!(
        reason,
        CallEndReason::Completed | CallEndReason::NetworkError
    ) {
        return Err(AppError::invalid_request(
            "Hangup reason must be completed or network_error",
        ));
    }

    end_call(
        pool,
        participant,
        call_id,
        reason,
        RequiredCallRole::Participant,
        RequiredCallClient::SelectedClient,
        &[CallState::Connecting, CallState::Active],
    )
    .await
}

pub async fn signal_target(
    pool: &PgPool,
    participant: &CurrentUser,
    call_id: Uuid,
) -> AppResult<CallSignalTarget> {
    let row = sqlx::query_as::<_, SignalTargetCallRow>(
        "select caller_user_id,
                callee_user_id,
                caller_client_id,
                accepted_client_id,
                state
         from call_sessions
         where call_id = $1",
    )
    .bind(call_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(call_not_found)?;

    let state = parse_call_state(&row.state)?;
    if state == CallState::Ended {
        return Err(call_ended());
    }
    if !matches!(state, CallState::Connecting | CallState::Active) {
        return Err(AppError::invalid_request("Call is not ready for signaling"));
    }

    if participant.user_id == row.caller_user_id {
        if participant.client_id != row.caller_client_id {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                ErrorCode::NotCallParticipant,
                "Only the originating caller client can signal this call",
            ));
        }
        let target_client_id = row
            .accepted_client_id
            .ok_or_else(|| AppError::invalid_request("Call has no accepted client"))?;
        return Ok(CallSignalTarget {
            target_user_id: row.callee_user_id,
            target_client_id,
        });
    }

    if participant.user_id == row.callee_user_id {
        if row.accepted_client_id != Some(participant.client_id) {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                ErrorCode::NotCallParticipant,
                "Only the accepted callee client can signal this call",
            ));
        }
        return Ok(CallSignalTarget {
            target_user_id: row.caller_user_id,
            target_client_id: row.caller_client_id,
        });
    }

    Err(not_call_participant())
}

pub async fn cleanup_timed_out_calls(
    pool: &PgPool,
    now: DateTime<Utc>,
    ringing_timeout: Duration,
) -> AppResult<Vec<CallCommandResult>> {
    let cutoff = now - ringing_timeout;
    let call_ids = sqlx::query_scalar::<_, Uuid>(
        "select call_id
         from call_sessions
         where state = 'ringing'
           and started_at < $1
         order by started_at, call_id",
    )
    .bind(cutoff)
    .fetch_all(pool)
    .await
    .map_err(internal_error)?;

    let mut ended = Vec::with_capacity(call_ids.len());
    for call_id in call_ids {
        if let Some(result) = end_call_for_cleanup(
            pool,
            call_id,
            CallEndReason::Timeout,
            &[CallState::Ringing],
            now,
        )
        .await?
        {
            ended.push(result);
        }
    }
    Ok(ended)
}

pub async fn cleanup_interrupted_calls(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    now: DateTime<Utc>,
    grace: Duration,
) -> AppResult<Vec<CallCommandResult>> {
    let rows = sqlx::query_as::<_, InterruptedCallRow>(
        "select call_id,
                caller_user_id,
                callee_user_id,
                caller_client_id,
                accepted_client_id,
                interruption_detected_at
         from call_sessions
         where state in ('connecting', 'active')
         order by started_at, call_id",
    )
    .fetch_all(pool)
    .await
    .map_err(internal_error)?;

    let mut ended = Vec::new();
    for row in rows {
        let caller_present = registry.contains_client(row.caller_user_id, row.caller_client_id);
        let callee_present = row.accepted_client_id.map_or(true, |client_id| {
            registry.contains_client(row.callee_user_id, client_id)
        });

        if caller_present && callee_present {
            if row.interruption_detected_at.is_some() {
                sqlx::query(
                    "update call_sessions
                     set interruption_detected_at = null
                     where call_id = $1
                       and state in ('connecting', 'active')",
                )
                .bind(row.call_id)
                .execute(pool)
                .await
                .map_err(internal_error)?;
            }
            continue;
        }

        match row.interruption_detected_at {
            Some(detected_at) if now.signed_duration_since(detected_at) >= grace => {
                if let Some(result) = end_call_for_cleanup(
                    pool,
                    row.call_id,
                    CallEndReason::NetworkError,
                    &[CallState::Connecting, CallState::Active],
                    now,
                )
                .await?
                {
                    ended.push(result);
                }
            }
            Some(_) => {}
            None => {
                sqlx::query(
                    "update call_sessions
                     set interruption_detected_at = $2
                     where call_id = $1
                       and state in ('connecting', 'active')
                       and interruption_detected_at is null",
                )
                .bind(row.call_id)
                .bind(now)
                .execute(pool)
                .await
                .map_err(internal_error)?;
            }
        }
    }

    Ok(ended)
}

pub async fn cleanup_non_ended_calls_on_startup(pool: &PgPool) -> AppResult<u64> {
    let call_ids = sqlx::query_scalar::<_, Uuid>(
        "select call_id
         from call_sessions
         where state <> 'ended'
         order by started_at, call_id",
    )
    .fetch_all(pool)
    .await
    .map_err(internal_error)?;

    let now = now_utc();
    let mut ended = 0;
    for call_id in call_ids {
        if end_call_for_cleanup(
            pool,
            call_id,
            CallEndReason::NetworkError,
            &[CallState::Ringing, CallState::Connecting, CallState::Active],
            now,
        )
        .await?
        .is_some()
        {
            ended += 1;
        }
    }
    Ok(ended)
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

async fn lock_call_session(
    tx: &mut Transaction<'_, Postgres>,
    call_id: Uuid,
) -> AppResult<LockedCallSessionRow> {
    sqlx::query_as::<_, LockedCallSessionRow>(
        "select call_id,
                conversation_id,
                caller_user_id,
                callee_user_id,
                caller_client_id,
                accepted_client_id,
                media_type,
                state,
                started_at,
                accepted_at
         from call_sessions
         where call_id = $1
         for update",
    )
    .bind(call_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal_error)?
    .ok_or_else(call_not_found)
}

async fn end_call(
    pool: &PgPool,
    actor: CurrentUser,
    call_id: Uuid,
    reason: CallEndReason,
    required_role: RequiredCallRole,
    required_client: RequiredCallClient,
    allowed_states: &[CallState],
) -> AppResult<CallCommandResult> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let call = lock_call_session(&mut tx, call_id).await?;
    ensure_required_role(&call, actor.user_id, required_role)?;
    if required_client == RequiredCallClient::SelectedClient {
        ensure_selected_call_client(&call, &actor)?;
    }

    let current_state = call_state(&call)?;
    if current_state == CallState::Ended {
        let call = call_summary_by_id(&mut tx, call_id).await?;
        tx.commit().await.map_err(internal_error)?;
        return Ok(CallCommandResult::without_call_event_message(call));
    }

    if !allowed_states.contains(&current_state) {
        return Err(AppError::invalid_request("Invalid call state transition"));
    }

    let result = finalize_locked_call(&mut tx, &call, &actor, reason, now_utc()).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(result)
}

async fn end_call_for_cleanup(
    pool: &PgPool,
    call_id: Uuid,
    reason: CallEndReason,
    allowed_states: &[CallState],
    ended_at: DateTime<Utc>,
) -> AppResult<Option<CallCommandResult>> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let call = lock_call_session(&mut tx, call_id).await?;
    let current_state = call_state(&call)?;
    if current_state == CallState::Ended || !allowed_states.contains(&current_state) {
        tx.commit().await.map_err(internal_error)?;
        return Ok(None);
    }

    let actor = caller_actor_for_call(&mut tx, &call).await?;
    let result = finalize_locked_call(&mut tx, &call, &actor, reason, ended_at).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(Some(result))
}

async fn caller_actor_for_call(
    tx: &mut Transaction<'_, Postgres>,
    call: &LockedCallSessionRow,
) -> AppResult<CurrentUser> {
    let row = sqlx::query_as::<_, CallActorRow>(
        "select username, display_name
         from users
         where user_id = $1",
    )
    .bind(call.caller_user_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(internal_error)?;

    Ok(CurrentUser {
        user_id: call.caller_user_id,
        username: row.username,
        display_name: row.display_name,
        client_id: call.caller_client_id,
    })
}

async fn finalize_locked_call(
    tx: &mut Transaction<'_, Postgres>,
    call: &LockedCallSessionRow,
    actor: &CurrentUser,
    reason: CallEndReason,
    ended_at: DateTime<Utc>,
) -> AppResult<CallCommandResult> {
    let conversation = messages_service::lock_conversation(tx, call.conversation_id).await?;
    let media_type = call_media_type(call)?;
    let duration_seconds = call_duration_seconds(call, ended_at, reason);

    sqlx::query(
        "update call_sessions
         set state = $2,
             ended_at = $3,
             end_reason = $4,
             interruption_detected_at = null
         where call_id = $1",
    )
    .bind(call.call_id)
    .bind(CallState::Ended.as_str())
    .bind(ended_at)
    .bind(reason.as_str())
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    update_call_participants_state(tx, call.call_id, CallState::Ended).await?;

    let message = messages_service::insert_call_event_message_in_locked_conversation(
        tx,
        &conversation,
        actor,
        call_record_body(media_type, reason, Some(duration_seconds)),
        json!({
            "call_id": call.call_id,
            "media_type": media_type.as_str(),
            "outcome": reason.as_str(),
            "duration_seconds": duration_seconds,
            "caller_user_id": call.caller_user_id,
            "callee_user_id": call.callee_user_id,
        }),
    )
    .await?;

    sqlx::query("update call_sessions set created_message_id = $2 where call_id = $1")
        .bind(call.call_id)
        .bind(message.message.message_id)
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;

    let call = call_summary_by_id(tx, call.call_id).await?;
    Ok(CallCommandResult::with_call_event_message(
        call,
        message.message,
    ))
}

async fn update_call_participants_state(
    tx: &mut Transaction<'_, Postgres>,
    call_id: Uuid,
    state: CallState,
) -> AppResult<()> {
    sqlx::query("update call_participants set state = $2 where call_id = $1")
        .bind(call_id)
        .bind(state.as_str())
        .execute(&mut **tx)
        .await
        .map_err(internal_error)?;
    Ok(())
}

fn ensure_required_role(
    call: &LockedCallSessionRow,
    user_id: UserId,
    required_role: RequiredCallRole,
) -> AppResult<()> {
    let actual_role = if user_id == call.caller_user_id {
        Some(RequiredCallRole::Caller)
    } else if user_id == call.callee_user_id {
        Some(RequiredCallRole::Callee)
    } else {
        None
    };

    match (required_role, actual_role) {
        (_, None) => Err(not_call_participant()),
        (RequiredCallRole::Participant, Some(_)) => Ok(()),
        (RequiredCallRole::Caller, Some(RequiredCallRole::Caller)) => Ok(()),
        (RequiredCallRole::Callee, Some(RequiredCallRole::Callee)) => Ok(()),
        (RequiredCallRole::Caller, Some(_)) => Err(AppError::invalid_request(
            "Only the caller can perform this call transition",
        )),
        (RequiredCallRole::Callee, Some(_)) => Err(AppError::invalid_request(
            "Only the callee can perform this call transition",
        )),
    }
}

fn ensure_selected_call_client(call: &LockedCallSessionRow, actor: &CurrentUser) -> AppResult<()> {
    if actor.user_id == call.caller_user_id {
        if actor.client_id == call.caller_client_id {
            return Ok(());
        }
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            ErrorCode::NotCallParticipant,
            "Only the originating caller client can perform this call transition",
        ));
    }

    if actor.user_id == call.callee_user_id {
        if call.accepted_client_id == Some(actor.client_id) {
            return Ok(());
        }
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            ErrorCode::NotCallParticipant,
            "Only the accepted callee client can perform this call transition",
        ));
    }

    Err(not_call_participant())
}

fn ensure_call_state(call: &LockedCallSessionRow, allowed_states: &[CallState]) -> AppResult<()> {
    let current_state = call_state(call)?;
    if allowed_states.contains(&current_state) {
        return Ok(());
    }
    if current_state == CallState::Ended {
        return Err(call_ended());
    }
    Err(AppError::invalid_request("Invalid call state transition"))
}

fn call_state(call: &LockedCallSessionRow) -> AppResult<CallState> {
    parse_call_state(&call.state)
}

fn call_media_type(call: &LockedCallSessionRow) -> AppResult<CallMediaType> {
    parse_media_type(&call.media_type)
}

fn call_duration_seconds(
    call: &LockedCallSessionRow,
    ended_at: DateTime<Utc>,
    reason: CallEndReason,
) -> i64 {
    if !matches!(
        reason,
        CallEndReason::Completed | CallEndReason::NetworkError
    ) {
        return 0;
    }

    let started_at = call.accepted_at.unwrap_or(call.started_at);
    ended_at
        .signed_duration_since(started_at)
        .num_seconds()
        .max(0)
}

async fn insert_ended_call_attempt(
    pool: &PgPool,
    caller: &CurrentUser,
    participants: &DirectCallParticipants,
    call_id: Uuid,
    conversation_id: Uuid,
    media_type: CallMediaType,
    reason: CallEndReason,
) -> AppResult<CallCommandResult> {
    let mut tx = pool.begin().await.map_err(internal_error)?;
    let conversation = messages_service::lock_conversation(&mut tx, conversation_id).await?;
    let call_event_message = insert_ended_call_attempt_in_locked_conversation(
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
    let call = call_summary_by_id(&mut tx, call_id).await?;
    tx.commit().await.map_err(internal_error)?;
    Ok(CallCommandResult::with_call_event_message(
        call,
        call_event_message,
    ))
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
) -> AppResult<MessageDto> {
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
        call_record_body(media_type, reason, Some(0)),
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

    Ok(message.message)
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

fn call_record_body(
    media_type: CallMediaType,
    reason: CallEndReason,
    duration_seconds: Option<i64>,
) -> String {
    let media = match media_type {
        CallMediaType::Audio => "语音通话",
        CallMediaType::Video => "视频通话",
    };
    match reason {
        CallEndReason::Completed => {
            format!("{media} {}", format_duration(duration_seconds.unwrap_or(0)))
        }
        CallEndReason::Rejected => format!("{media} 已拒绝"),
        CallEndReason::Canceled => format!("{media} 已取消"),
        CallEndReason::Timeout => format!("{media} 超时未接"),
        CallEndReason::Busy => format!("{media} 忙线未接通"),
        CallEndReason::Offline => format!("{media} 对方离线"),
        CallEndReason::NetworkError => format!("{media} 网络中断"),
    }
}

fn format_duration(seconds: i64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    format!("{minutes:02}:{seconds:02}")
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

fn call_ended() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        ErrorCode::CallEnded,
        "Call has already ended",
    )
}

fn not_call_participant() -> AppError {
    AppError::new(
        StatusCode::FORBIDDEN,
        ErrorCode::NotCallParticipant,
        "User is not a call participant",
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
