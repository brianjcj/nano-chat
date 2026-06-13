use sqlx::{Executor, PgPool};

pub async fn test_pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set TEST_DATABASE_URL or DATABASE_URL for database tests");
    PgPool::connect(&url).await.expect("connect test database")
}

pub async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}
