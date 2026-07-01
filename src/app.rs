use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration as StdDuration,
};

use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::Duration as ChronoDuration;
use sqlx::PgPool;
use tower_http::services::{ServeDir, ServeFile};

use crate::{
    auth, calls,
    config::Config,
    conversations,
    realtime::{
        connection_registry::ConnectionRegistry,
        notify::{NotifyPublisher, fanout_notify_payload},
        types::{RealtimeEvent, RealtimeNotifyPayload},
    },
    time::now_utc,
    users, ws,
};

#[derive(Clone)]
pub struct AppLifecycle {
    draining: Arc<AtomicBool>,
    notify_listener_ready: Arc<AtomicBool>,
}

impl Default for AppLifecycle {
    fn default() -> Self {
        Self {
            draining: Arc::new(AtomicBool::new(false)),
            notify_listener_ready: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl AppLifecycle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn mark_draining(&self) {
        self.draining.store(true, Ordering::SeqCst);
    }

    pub fn is_draining(&self) -> bool {
        self.draining.load(Ordering::SeqCst)
    }

    pub fn mark_notify_listener_ready(&self) {
        self.notify_listener_ready.store(true, Ordering::SeqCst);
    }

    pub fn mark_notify_listener_not_ready(&self) {
        self.notify_listener_ready.store(false, Ordering::SeqCst);
    }

    pub fn is_notify_listener_ready(&self) -> bool {
        self.notify_listener_ready.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
    pub registry: ConnectionRegistry,
    pub instance_id: String,
    pub notify_publisher: NotifyPublisher,
    lifecycle: AppLifecycle,
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
            lifecycle: AppLifecycle::new(),
        }
    }

    pub fn lifecycle(&self) -> AppLifecycle {
        self.lifecycle.clone()
    }

    pub fn mark_draining(&self) {
        self.lifecycle.mark_draining();
    }

    pub fn is_draining(&self) -> bool {
        self.lifecycle.is_draining()
    }

    pub fn mark_notify_listener_ready(&self) {
        self.lifecycle.mark_notify_listener_ready();
    }

    pub fn mark_notify_listener_not_ready(&self) {
        self.lifecycle.mark_notify_listener_not_ready();
    }

    pub fn is_notify_listener_ready(&self) -> bool {
        self.lifecycle.is_notify_listener_ready()
    }
}

pub fn spawn_call_cleanup_task(state: AppState) -> tokio::task::JoinHandle<()> {
    let cleanup_interval_secs = state.config.call_cleanup_interval_secs.max(1);
    let ringing_timeout = chrono_seconds(state.config.call_ringing_timeout_secs);
    let disconnect_grace = chrono_seconds(state.config.call_disconnect_grace_secs);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(StdDuration::from_secs(cleanup_interval_secs));
        loop {
            interval.tick().await;
            let now = now_utc();

            match calls::service::cleanup_timed_out_calls(&state.pool, now, ringing_timeout).await {
                Ok(results) => publish_call_cleanup_results(&state, results).await,
                Err(error) => tracing::warn!(%error, "call ringing timeout cleanup failed"),
            }

            match calls::service::cleanup_interrupted_calls(
                &state.pool,
                &state.registry,
                now,
                disconnect_grace,
            )
            .await
            {
                Ok(results) => publish_call_cleanup_results(&state, results).await,
                Err(error) => tracing::warn!(%error, "call interruption cleanup failed"),
            }
        }
    })
}

fn chrono_seconds(seconds: u64) -> ChronoDuration {
    ChronoDuration::seconds(seconds.min(i64::MAX as u64) as i64)
}

async fn publish_call_cleanup_results(
    state: &AppState,
    results: Vec<calls::types::CallCommandResult>,
) {
    for result in results {
        publish_call_ended(state, result).await;
    }
}

async fn publish_call_ended(state: &AppState, result: calls::types::CallCommandResult) {
    let event = RealtimeEvent::CallEnded { call: result.call };
    let event_type = event.event_type();
    let payload = RealtimeNotifyPayload {
        origin_instance_id: state.instance_id.clone(),
        origin_connection_id: None,
        event,
    };

    if let Err(error) = fanout_notify_payload(&state.pool, &state.registry, &payload).await {
        tracing::warn!(%error, event_type, "failed to fan out call cleanup event locally");
    }

    if let Err(error) = state.notify_publisher.publish(&payload).await {
        tracing::warn!(%error, event_type, "failed to publish call cleanup notify event");
    }
}

pub fn build_router(state: AppState) -> Router {
    let web_dist_dir = PathBuf::from(&state.config.web_dist_dir);
    let spa_index = web_dist_dir.join("index.html");
    let spa_fallback = ServeDir::new(&web_dist_dir).fallback(ServeFile::new(spa_index));
    let assets_dir = web_dist_dir.join("assets");

    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .merge(ws::router())
        .nest("/api/v1", api_router())
        .nest_service("/assets", ServeDir::new(assets_dir))
        .fallback_service(spa_fallback)
        .with_state(state)
}

fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::http::router())
        .merge(users::http::router())
        .merge(conversations::http::router())
        .fallback(api_not_found)
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

async fn healthz() -> StatusCode {
    StatusCode::OK
}

async fn readyz(State(state): State<AppState>) -> StatusCode {
    if state.is_draining() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }

    if !state.is_notify_listener_ready() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }

    match sqlx::query_scalar::<_, i32>("select 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(1) => StatusCode::OK,
        Ok(value) => {
            tracing::warn!(value, "readiness database check returned unexpected value");
            StatusCode::SERVICE_UNAVAILABLE
        }
        Err(error) => {
            tracing::warn!(%error, "readiness database check failed");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}
