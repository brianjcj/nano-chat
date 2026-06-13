use axum::{Router, http::StatusCode, routing::get};
use sqlx::PgPool;

use crate::{
    auth,
    config::Config,
    conversations,
    realtime::{connection_registry::ConnectionRegistry, notify::NotifyPublisher},
    users, ws,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
    pub registry: ConnectionRegistry,
    pub instance_id: String,
    pub notify_publisher: NotifyPublisher,
}

impl AppState {
    pub fn new(config: Config, pool: PgPool) -> Self {
        let registry = ConnectionRegistry::new(config.max_connections_per_user);
        Self::with_registry(config, pool, registry)
    }

    pub fn with_registry(config: Config, pool: PgPool, registry: ConnectionRegistry) -> Self {
        Self::with_registry_and_instance_id(
            config,
            pool,
            registry,
            uuid::Uuid::now_v7().to_string(),
        )
    }

    pub fn with_registry_and_instance_id(
        config: Config,
        pool: PgPool,
        registry: ConnectionRegistry,
        instance_id: String,
    ) -> Self {
        let notify_publisher = NotifyPublisher::new(pool.clone(), config.notify_channel.clone());
        Self {
            config,
            pool,
            registry,
            instance_id,
            notify_publisher,
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .merge(ws::router())
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
