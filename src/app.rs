use axum::{Router, http::StatusCode, routing::get};
use sqlx::PgPool;

use crate::{auth, config::Config, conversations, users};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
}

impl AppState {
    pub fn new(config: Config, pool: PgPool) -> Self {
        Self { config, pool }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .nest("/api/v1", api_router())
        .with_state(state)
}

fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::http::router())
        .merge(users::http::router())
        .merge(conversations::http::router())
}

async fn healthz() -> StatusCode {
    StatusCode::OK
}

async fn readyz() -> StatusCode {
    StatusCode::OK
}
