use axum::{
    Json, Router,
    extract::{FromRequestParts, State, rejection::JsonRejection},
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
    response::IntoResponse,
    routing::post,
};

use crate::{
    app::AppState,
    auth::{
        service,
        types::{CurrentUser, LoginRequest, RegisterRequest},
    },
    error::AppError,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
}

async fn register(
    State(state): State<AppState>,
    request: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<impl IntoResponse, AppError> {
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let response = service::register(&state.pool, &state.config, request).await?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn login(
    State(state): State<AppState>,
    request: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<impl IntoResponse, AppError> {
    let Json(request) = request.map_err(AppError::from_json_rejection)?;
    let response = service::login(&state.pool, &state.config, request).await?;
    Ok(Json(response))
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let authorization = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok());
        service::authenticate_bearer(&state.pool, &state.config, authorization).await
    }
}
