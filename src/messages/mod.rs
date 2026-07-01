pub mod service;
pub mod types;

#[cfg(test)]
mod tests {
    use serde_json::json;
    use serial_test::serial;
    use sqlx::{Executor, PgPool, Row};
    use uuid::Uuid;

    use super::{
        service,
        types::{DirectTarget, MessageCursor},
    };
    use crate::{
        auth::types::CurrentUser,
        conversations::service as conversations_service,
        db,
        ids::{UserId, new_uuid_v7},
        time::now_utc,
    };

    const DEFAULT_TEST_DATABASE_URL: &str = "postgres://nano:nano@localhost:5432/nano_chat_test";

    #[tokio::test]
    #[serial]
    async fn insert_call_event_message_in_locked_conversation_persists_call_event_details() {
        let pool = test_pool().await;
        reset_database(&pool).await;
        db::run_migrations(&pool)
            .await
            .expect("run test migrations");

        let alice = insert_test_user(&pool, "alice").await;
        let bob = insert_test_user(&pool, "bob").await;
        let seed = service::send_direct_message(
            &pool,
            alice.clone(),
            DirectTarget::Username("bob".to_string()),
            "seed-text".to_string(),
            "hello before call".to_string(),
        )
        .await
        .expect("seed direct conversation");
        let metadata = json!({
            "call_id": "018f0000-0000-7000-8000-000000000040",
            "media_type": "video",
            "outcome": "completed",
            "duration_seconds": 192,
            "caller_user_id": alice.user_id,
            "callee_user_id": bob.user_id,
        });

        let call_event = {
            let mut tx = pool.begin().await.expect("begin transaction");
            let conversation = service::lock_conversation(&mut tx, seed.conversation_id)
                .await
                .expect("lock conversation");

            let inserted = service::insert_call_event_message_in_locked_conversation(
                &mut tx,
                &conversation,
                &alice,
                "Video call 03:12".to_string(),
                metadata.clone(),
            )
            .await
            .expect("insert call event message");
            tx.commit().await.expect("commit call event message");
            inserted
        };

        assert!(call_event.newly_created());
        assert_eq!(call_event.conversation_id, seed.conversation_id);
        assert_eq!(call_event.message.conversation_id, seed.conversation_id);
        assert_eq!(call_event.message.message_seq, seed.message.message_seq + 1);
        assert_eq!(call_event.message.body, "Video call 03:12");
        assert_eq!(call_event.message.message_type, "call_event");
        assert_eq!(call_event.message.metadata, metadata);

        let conversation_row = sqlx::query(
            "select last_message_seq, last_message_id
             from conversations
             where conversation_id = $1",
        )
        .bind(seed.conversation_id)
        .fetch_one(&pool)
        .await
        .expect("load updated conversation");
        assert_eq!(
            conversation_row.get::<i64, _>("last_message_seq"),
            call_event.message.message_seq
        );
        assert_eq!(
            conversation_row.get::<Uuid, _>("last_message_id"),
            call_event.message.message_id
        );

        let history = service::list_messages(
            &pool,
            bob.clone(),
            seed.conversation_id,
            MessageCursor {
                after_seq: None,
                before_seq: None,
                limit: 10,
            },
        )
        .await
        .expect("list visible messages");
        assert_eq!(history.len(), 2);
        let history_call_event = history.last().expect("call event in history");
        assert_eq!(history_call_event.message_id, call_event.message.message_id);
        assert_eq!(history_call_event.message_type, "call_event");
        assert_eq!(history_call_event.metadata, metadata);

        let bob_conversations = conversations_service::list_conversations(&pool, bob.user_id)
            .await
            .expect("list bob conversations");
        let listed = bob_conversations
            .iter()
            .find(|conversation| conversation.conversation_id == seed.conversation_id)
            .expect("conversation should remain listed");
        assert_eq!(listed.latest_message_seq, call_event.message.message_seq);
        let latest = listed
            .latest_message
            .as_ref()
            .expect("latest message summary");
        assert_eq!(latest.message_id, call_event.message.message_id);
        assert_eq!(latest.message_type, "call_event");
        assert_eq!(latest.metadata, metadata);
    }

    async fn test_pool() -> PgPool {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| DEFAULT_TEST_DATABASE_URL.to_string());
        PgPool::connect(&database_url)
            .await
            .expect("connect test database")
    }

    async fn reset_database(pool: &PgPool) {
        pool.execute("drop schema public cascade; create schema public;")
            .await
            .expect("reset public schema");
    }

    async fn insert_test_user(pool: &PgPool, username: &str) -> CurrentUser {
        let now = now_utc();
        let user_id = sqlx::query_scalar::<_, UserId>(
            "insert into users (username, display_name, password_hash, created_at, updated_at)
             values ($1, $2, 'test-password-hash', $3, $3)
             returning user_id",
        )
        .bind(username)
        .bind(title_case(username))
        .bind(now)
        .fetch_one(pool)
        .await
        .expect("insert test user");
        let client_id = new_uuid_v7();

        sqlx::query(
            "insert into clients (client_id, user_id, created_at, last_login_at)
             values ($1, $2, $3, $3)",
        )
        .bind(client_id)
        .bind(user_id)
        .bind(now)
        .execute(pool)
        .await
        .expect("insert test client");

        CurrentUser {
            user_id,
            username: username.to_string(),
            display_name: Some(title_case(username)),
            client_id,
        }
    }

    fn title_case(username: &str) -> String {
        let mut chars = username.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => username.to_string(),
        }
    }
}
