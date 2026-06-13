use axum::{Json, Router, extract::Query, extract::State, routing::get};

use crate::{
    app::AppState,
    auth::types::CurrentUser,
    error::AppResult,
    users::{
        service,
        types::{UpdateMeRequest, UserSummary, UsernameLookupQuery},
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me", get(get_me).patch(patch_me))
        .route("/users", get(get_user_by_username))
}

async fn get_me(current_user: CurrentUser) -> Json<UserSummary> {
    Json(current_user.summary())
}

async fn patch_me(
    current_user: CurrentUser,
    State(state): State<AppState>,
    Json(request): Json<UpdateMeRequest>,
) -> AppResult<Json<UserSummary>> {
    let user =
        service::update_display_name(&state.pool, current_user.user_id, request.display_name)
            .await?;
    Ok(Json(user))
}

async fn get_user_by_username(
    _current_user: CurrentUser,
    State(state): State<AppState>,
    Query(query): Query<UsernameLookupQuery>,
) -> AppResult<Json<UserSummary>> {
    let user = service::get_user_by_username(&state.pool, &query.username).await?;
    Ok(Json(user))
}
