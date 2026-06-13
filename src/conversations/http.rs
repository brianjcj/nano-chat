use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::types::CurrentUser,
    conversations::{
        service,
        types::{AddMemberRequest, CreateGroupRequest},
    },
    error::{AppError, AppResult},
    messages::{service as message_service, types::MessageCursor},
    realtime::{
        notify::fanout_notify_payload,
        types::{RealtimeEvent, RealtimeNotifyPayload},
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/conversations", get(list_conversations))
        .route("/conversations/groups", post(create_group))
        .route(
            "/conversations/{conversation_id}/messages",
            get(list_messages),
        )
        .route(
            "/conversations/{conversation_id}/members",
            get(list_members).post(add_member),
        )
        .route(
            "/conversations/{conversation_id}/members/me",
            delete(leave_group),
        )
}

async fn list_conversations(
    current_user: CurrentUser,
    State(state): State<AppState>,
) -> AppResult<impl IntoResponse> {
    let conversations = service::list_conversations(&state.pool, current_user.user_id).await?;
    Ok(Json(conversations))
}

async fn create_group(
    current_user: CurrentUser,
    State(state): State<AppState>,
    request: Result<Json<CreateGroupRequest>, JsonRejection>,
) -> AppResult<impl IntoResponse> {
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let group = service::create_group(&state.pool, current_user.user_id, request).await?;
    Ok((StatusCode::CREATED, Json(group)))
}

async fn list_messages(
    current_user: CurrentUser,
    State(state): State<AppState>,
    conversation_id: Result<Path<Uuid>, PathRejection>,
    cursor: Result<Query<MessageCursor>, QueryRejection>,
) -> AppResult<impl IntoResponse> {
    let Path(conversation_id) = conversation_id.map_err(AppError::from_path_rejection)?;
    let Query(cursor) = cursor.map_err(AppError::from_query_rejection)?;
    let messages =
        message_service::list_messages(&state.pool, current_user, conversation_id, cursor).await?;
    Ok(Json(messages))
}

async fn list_members(
    current_user: CurrentUser,
    State(state): State<AppState>,
    conversation_id: Result<Path<Uuid>, PathRejection>,
) -> AppResult<impl IntoResponse> {
    let Path(conversation_id) = conversation_id.map_err(AppError::from_path_rejection)?;
    let members = service::list_members(&state.pool, current_user.user_id, conversation_id).await?;
    Ok(Json(members))
}

async fn add_member(
    current_user: CurrentUser,
    State(state): State<AppState>,
    conversation_id: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<AddMemberRequest>, JsonRejection>,
) -> AppResult<impl IntoResponse> {
    let Path(conversation_id) = conversation_id.map_err(AppError::from_path_rejection)?;
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let result = service::add_member_with_status(
        &state.pool,
        current_user.user_id,
        conversation_id,
        request.user_id,
    )
    .await?;
    if result.newly_added {
        publish_conversation_event(
            &state,
            RealtimeEvent::ConversationMemberAdded {
                conversation_id,
                member: result.member.clone(),
            },
        )
        .await;
    }
    Ok(Json(result.member))
}

async fn leave_group(
    current_user: CurrentUser,
    State(state): State<AppState>,
    conversation_id: Result<Path<Uuid>, PathRejection>,
) -> AppResult<StatusCode> {
    let Path(conversation_id) = conversation_id.map_err(AppError::from_path_rejection)?;
    let result =
        service::leave_group_with_status(&state.pool, current_user.user_id, conversation_id)
            .await?;
    publish_conversation_event(
        &state,
        RealtimeEvent::ConversationMemberLeft {
            conversation_id,
            user_id: current_user.user_id,
        },
    )
    .await;
    if result.dissolved {
        publish_conversation_event(
            &state,
            RealtimeEvent::ConversationDissolved {
                conversation_id,
                user_id: current_user.user_id,
            },
        )
        .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn publish_conversation_event(state: &AppState, event: RealtimeEvent) {
    let payload = RealtimeNotifyPayload {
        origin_instance_id: state.instance_id.clone(),
        origin_connection_id: None,
        event,
    };

    if let Err(error) = fanout_notify_payload(&state.pool, &state.registry, &payload).await {
        tracing::warn!(%error, "failed to fan out conversation realtime event locally");
    }

    if let Err(error) = state.notify_publisher.publish(&payload).await {
        tracing::warn!(%error, "failed to publish conversation realtime notify event");
    }
}
