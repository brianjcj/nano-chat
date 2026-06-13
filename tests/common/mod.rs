use axum::Router;
use nano_chat::{
    app::{AppState, build_router},
    config::Config,
};
use sqlx::{Executor, PgPool};

pub async fn test_pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("set TEST_DATABASE_URL for destructive database tests");
    let url =
        validate_test_database_url(&url).expect("TEST_DATABASE_URL must point to a test database");
    PgPool::connect(&url).await.expect("connect test database")
}

pub fn validate_test_database_url(url: &str) -> Result<String, String> {
    let database_name = url
        .rsplit_once('/')
        .map(|(_, database)| database.split('?').next().unwrap_or(database))
        .filter(|database| !database.is_empty())
        .ok_or_else(|| "database URL must include a database name".to_string())?;

    if database_name.contains("test") {
        Ok(url.to_string())
    } else {
        Err(format!(
            "refusing to reset non-test database '{database_name}'; use TEST_DATABASE_URL with a database name containing 'test'"
        ))
    }
}

pub async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}

#[allow(dead_code)]
pub async fn test_app() -> Router {
    let pool = test_pool().await;
    reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool)
        .await
        .expect("run test migrations");
    build_router(AppState::new(test_config(), pool))
}

#[allow(dead_code)]
pub fn test_config() -> Config {
    Config {
        database_url: std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://nano:nano@localhost:5432/nano_chat_test".to_string()),
        jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
        bind_addr: "127.0.0.1:0".to_string(),
        rust_log: "nano_chat=debug".to_string(),
        notify_channel: "nano_chat_events".to_string(),
        max_connections_per_user: 10,
        heartbeat_interval_secs: 30,
        heartbeat_idle_timeout_secs: 90,
        max_ws_payload_bytes: 64 * 1024,
        max_message_bytes: 4096,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_test_database_url;

    #[test]
    fn accepts_database_url_with_test_database_name() {
        let url = "postgres://nano:nano@localhost:5432/nano_chat_test";
        assert_eq!(validate_test_database_url(url).unwrap(), url);
    }

    #[test]
    fn rejects_database_url_without_test_database_name() {
        let error = validate_test_database_url("postgres://nano:nano@localhost:5432/nano_chat")
            .expect_err("non-test database should be rejected");
        assert!(error.contains("refusing to reset non-test database"));
    }
}
