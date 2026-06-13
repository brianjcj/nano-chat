use anyhow::Context;
use nano_chat::{
    app::{AppState, build_router},
    config::Config,
    db,
    realtime::{notify::NotifyListener, types::RealtimeEvent},
};
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    init_tracing(&config.rust_log)?;

    let pool = db::create_lazy_pool(&config.database_url)?;
    let bind_addr = config.bind_addr.clone();
    let state = AppState::new(config, pool);
    let _notify_listener = NotifyListener::start_with_readiness(
        &state.config.database_url,
        state.config.notify_channel.clone(),
        state.instance_id.clone(),
        state.pool.clone(),
        state.registry.clone(),
        state.lifecycle(),
    );
    let app = build_router(state.clone()).layer(TraceLayer::new_for_http());

    let listener = TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("failed to bind {bind_addr}"))?;
    tracing::info!(%bind_addr, "serving nano chat");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(state))
        .await?;
    Ok(())
}

async fn shutdown_signal(state: AppState) {
    if let Err(error) = wait_for_shutdown_signal().await {
        tracing::error!(%error, "failed to listen for shutdown signal");
        return;
    }

    state.mark_draining();
    let delivered = state
        .registry
        .send_to_all(RealtimeEvent::ServerDraining.server_envelope(), None);
    tracing::info!(delivered, "shutdown signal received; app is draining");
}

#[cfg(unix)]
async fn wait_for_shutdown_signal() -> std::io::Result<()> {
    use tokio::signal::unix::{SignalKind, signal};

    let mut terminate = signal(SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() -> std::io::Result<()> {
    tokio::signal::ctrl_c().await
}

fn init_tracing(rust_log: &str) -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_new(rust_log).context("invalid RUST_LOG")?;
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .json()
        .init();
    Ok(())
}
