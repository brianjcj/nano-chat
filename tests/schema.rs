mod common;

use sqlx::Row;

#[tokio::test]
async fn migrations_create_core_tables() {
    let pool = common::test_pool().await;
    common::reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool).await.unwrap();

    let tables = sqlx::query(
        "select table_name from information_schema.tables where table_schema = 'public'",
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| row.get::<String, _>("table_name"))
    .collect::<std::collections::HashSet<_>>();

    for expected in [
        "users",
        "clients",
        "conversations",
        "direct_conversation_pairs",
        "conversation_members",
        "conversation_member_spans",
        "messages",
    ] {
        assert!(tables.contains(expected), "missing table {expected}");
    }
}
