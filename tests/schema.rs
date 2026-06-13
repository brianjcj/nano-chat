mod common;

use sqlx::Row;

#[test]
fn migration_allows_empty_closed_visibility_spans() {
    let migration = include_str!("../migrations/0001_init.sql");
    assert!(
        migration.contains("to_seq >= from_seq - 1"),
        "span range check should allow empty closed spans"
    );
}

#[test]
fn migration_enforces_one_open_visibility_span() {
    let migration = include_str!("../migrations/0001_init.sql");
    assert!(migration.contains("create unique index conversation_member_spans_one_open_idx"));
    assert!(migration.contains("where to_seq is null"));
}

#[test]
fn migration_requires_dissolved_timestamp_for_dissolved_conversations() {
    let migration = include_str!("../migrations/0001_init.sql");
    assert!(migration.contains("state = 'dissolved' and dissolved_at is not null"));
}

#[tokio::test]
#[serial_test::serial]
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
