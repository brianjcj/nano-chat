use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
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
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/conversations", get(list_conversations))
        .route("/conversations/groups", post(create_group))
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

async fn list_members(
    current_user: CurrentUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
) -> AppResult<impl IntoResponse> {
    let members = service::list_members(&state.pool, current_user.user_id, conversation_id).await?;
    Ok(Json(members))
}

async fn add_member(
    current_user: CurrentUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
    request: Result<Json<AddMemberRequest>, JsonRejection>,
) -> AppResult<impl IntoResponse> {
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let member = service::add_member(
        &state.pool,
        current_user.user_id,
        conversation_id,
        request.user_id,
    )
    .await?;
    Ok(Json(member))
}

async fn leave_group(
    current_user: CurrentUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    service::leave_group(&state.pool, current_user.user_id, conversation_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
