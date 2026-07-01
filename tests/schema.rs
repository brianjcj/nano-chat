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

#[tokio::test]
#[serial_test::serial]
async fn calls_schema_and_call_event_message_columns_exist() {
    let ctx = common::TestContext::new().await;

    let call_sessions_exists: bool = sqlx::query_scalar(
        "select exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'call_sessions'
        )",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(call_sessions_exists);

    let call_participants_exists: bool = sqlx::query_scalar(
        "select exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'call_participants'
        )",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(call_participants_exists);

    let message_type_default: String = sqlx::query_scalar(
        "select column_default
         from information_schema.columns
         where table_name = 'messages' and column_name = 'message_type'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(message_type_default.contains("'text'"));

    let metadata_type: String = sqlx::query_scalar(
        "select data_type
         from information_schema.columns
         where table_name = 'messages' and column_name = 'metadata'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(metadata_type, "jsonb");
}
