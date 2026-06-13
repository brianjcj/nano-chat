use anyhow::Context;
use nano_chat::{
    app::{AppState, build_router},
    config::Config,
    db,
    realtime::notify::NotifyListener,
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
    let _notify_listener = NotifyListener::start(
        &state.config.database_url,
        state.config.notify_channel.clone(),
        state.instance_id.clone(),
        state.pool.clone(),
        state.registry.clone(),
    )
    .await?;
    let app = build_router(state).layer(TraceLayer::new_for_http());

    let listener = TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("failed to bind {bind_addr}"))?;
    tracing::info!(%bind_addr, "serving nano chat");

    axum::serve(listener, app).await?;
    Ok(())
}

fn init_tracing(rust_log: &str) -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_new(rust_log).context("invalid RUST_LOG")?;
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .json()
        .init();
    Ok(())
}
