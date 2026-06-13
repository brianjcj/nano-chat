use axum::{
    Json, Router,
    extract::{
        Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    routing::get,
};

use crate::{
    app::AppState,
    auth::types::CurrentUser,
    error::{AppError, AppResult},
    users::{
        service,
        types::{PatchField, UpdateMeRequest, UserSummary, UsernameLookupQuery},
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
    request: Result<Json<UpdateMeRequest>, JsonRejection>,
) -> AppResult<Json<UserSummary>> {
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let display_name = match request.display_name {
        PatchField::Missing => {
            return Err(AppError::invalid_request("display_name field is required"));
        }
        PatchField::Present(display_name) => display_name,
    };

    let user =
        service::update_display_name(&state.pool, current_user.user_id, display_name).await?;
    Ok(Json(user))
}

async fn get_user_by_username(
    _current_user: CurrentUser,
    State(state): State<AppState>,
    query: Result<Query<UsernameLookupQuery>, QueryRejection>,
) -> AppResult<Json<UserSummary>> {
    let Query(query) = query.map_err(AppError::from_query_rejection)?;
    let user = service::get_user_by_username(&state.pool, &query.username).await?;
    Ok(Json(user))
}
