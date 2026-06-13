mod common;

use std::time::Duration;

use nano_chat::{
    app::AppState,
    config::Config,
    db,
    messages::types::MessageDto,
    realtime::{
        connection_registry::ConnectionRegistry,
        notify::{NotifyListener, fanout_notify_payload},
        types::{RealtimeEvent, RealtimeNotifyPayload},
    },
    users::types::UserSummary,
};
use serde_json::Value;
use sqlx::{Executor, PgPool};
use tokio::sync::mpsc;
use uuid::Uuid;

#[test]
fn notify_payload_round_trips_complete_message_event_with_origin() {
    let payload = RealtimeNotifyPayload {
        origin_instance_id: "instance-a".to_string(),
        origin_connection_id: Some(Uuid::now_v7()),
        event: RealtimeEvent::MessageCreated {
            conversation_id: Uuid::now_v7(),
            message: test_message(),
        },
    };

    let encoded = payload.to_pg_notify_payload().unwrap();
    assert!(encoded.len() < 8_000);

    let decoded = RealtimeNotifyPayload::from_pg_notify_payload(&encoded).unwrap();
    assert_eq!(decoded, payload);
}

#[test]
fn notify_payload_rejects_postgres_payloads_at_or_above_limit() {
    let payload = RealtimeNotifyPayload {
        origin_instance_id: "instance-a".to_string(),
        origin_connection_id: None,
        event: RealtimeEvent::MessageCreated {
            conversation_id: Uuid::now_v7(),
            message: MessageDto {
                body: "x".repeat(8_000),
                ..test_message()
            },
        },
    };

    let error = payload
        .to_pg_notify_payload()
        .expect_err("oversized payload should be rejected before pg_notify");
    assert!(error.to_string().contains("Postgres NOTIFY payload"));
}

#[tokio::test]
#[serial_test::serial]
async fn local_notify_fanout_skips_origin_and_uses_message_visibility_spans() {
    let ctx = RealtimeTestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;
    ctx.leave_group(&carol, group.conversation_id).await;
    let sent = ctx
        .send_message(
            &bob,
            group.conversation_id,
            "visible-seq",
            "hello before rejoin",
        )
        .await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;

    let registry = ConnectionRegistry::new(10);
    let (origin_tx, mut origin_rx) = mpsc::channel(10);
    let (alice_other_tx, mut alice_other_rx) = mpsc::channel(10);
    let (bob_tx, mut bob_rx) = mpsc::channel(10);
    let (carol_tx, mut carol_rx) = mpsc::channel(10);

    let origin = registry
        .register(alice.user_id, alice.client_id, origin_tx)
        .unwrap();
    registry
        .register(alice.user_id, Uuid::now_v7(), alice_other_tx)
        .unwrap();
    registry
        .register(bob.user_id, bob.client_id, bob_tx)
        .unwrap();
    registry
        .register(carol.user_id, carol.client_id, carol_tx)
        .unwrap();

    let payload = RealtimeNotifyPayload {
        origin_instance_id: "instance-a".to_string(),
        origin_connection_id: Some(origin.connection_id),
        event: RealtimeEvent::MessageCreated {
            conversation_id: group.conversation_id,
            message: sent.message.clone(),
        },
    };

    let delivered = fanout_notify_payload(&ctx.pool, &registry, &payload)
        .await
        .expect("fanout should resolve recipients");

    assert_eq!(delivered, 2);
    assert!(origin_rx.try_recv().is_err());
    assert_message_created_for(&mut alice_other_rx, sent.message.message_id).await;
    assert_message_created_for(&mut bob_rx, sent.message.message_id).await;
    assert!(carol_rx.try_recv().is_err());
}

#[tokio::test]
#[serial_test::serial]
async fn postgres_notify_listener_fans_out_to_another_instance_registry() {
    let ctx = RealtimeTestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let sent = ctx
        .send_direct_message(&alice, "bob", "cross-instance", "hello from instance a")
        .await;

    let channel = unique_notify_channel();
    let instance_a_id = "instance-a".to_string();
    let instance_b_id = "instance-b".to_string();
    let mut config = ctx.config.clone();
    config.notify_channel = channel;

    let state_a = AppState::with_registry_and_instance_id(
        config.clone(),
        ctx.pool.clone(),
        ConnectionRegistry::new(config.max_connections_per_user),
        instance_a_id,
    );
    let state_b = AppState::with_registry_and_instance_id(
        config.clone(),
        ctx.pool.clone(),
        ConnectionRegistry::new(config.max_connections_per_user),
        instance_b_id,
    );

    let (bob_tx, mut bob_rx) = mpsc::channel(10);
    state_b
        .registry
        .register(bob.user_id, bob.client_id, bob_tx)
        .unwrap();

    let listener = NotifyListener::connect(
        &state_b.config.database_url,
        state_b.config.notify_channel.clone(),
        state_b.instance_id.clone(),
        state_b.pool.clone(),
        state_b.registry.clone(),
    )
    .await
    .expect("listener should connect and LISTEN before publishing");
    let listener_task = listener.spawn();

    state_a
        .notify_publisher
        .publish(&RealtimeNotifyPayload {
            origin_instance_id: state_a.instance_id.clone(),
            origin_connection_id: Some(Uuid::now_v7()),
            event: RealtimeEvent::MessageCreated {
                conversation_id: sent.conversation_id,
                message: sent.message.clone(),
            },
        })
        .await
        .expect("publish should call pg_notify");

    assert_message_created_for(&mut bob_rx, sent.message.message_id).await;
    listener_task.abort();
}

async fn assert_message_created_for(
    receiver: &mut mpsc::Receiver<nano_chat::ws::protocol::ServerEnvelope>,
    message_id: Uuid,
) {
    let envelope = tokio::time::timeout(Duration::from_secs(2), receiver.recv())
        .await
        .expect("recipient should receive event before timeout")
        .expect("recipient channel should be open");
    assert_eq!(envelope.message_type, "message.created");
    let payload = envelope.payload.expect("event payload");
    assert_eq!(
        payload["message"]["message_id"],
        Value::String(message_id.to_string())
    );
}

fn test_message() -> MessageDto {
    MessageDto {
        message_id: Uuid::now_v7(),
        conversation_id: Uuid::now_v7(),
        message_seq: 1,
        sender: UserSummary {
            user_id: Uuid::now_v7(),
            username: "alice".to_string(),
            display_name: Some("Alice".to_string()),
        },
        body: "hello".to_string(),
        created_at: chrono::DateTime::parse_from_rfc3339("2026-06-13T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
    }
}

fn unique_notify_channel() -> String {
    format!("nano_chat_events_{}", Uuid::now_v7().simple())
}

struct RealtimeTestContext {
    config: Config,
    pool: PgPool,
    inner: common::TestContext,
}

impl RealtimeTestContext {
    async fn new() -> Self {
        let config = realtime_test_config();
        let pool = PgPool::connect(&config.database_url)
            .await
            .expect("connect test database");
        reset_database(&pool).await;
        db::run_migrations(&pool)
            .await
            .expect("run test migrations");
        let app = nano_chat::app::build_router(nano_chat::app::AppState::new(
            config.clone(),
            pool.clone(),
        ));
        Self {
            config,
            pool: pool.clone(),
            inner: common::TestContext { app, pool },
        }
    }

    async fn register(&self, username: &str) -> common::TestUser {
        self.inner.register(username).await
    }

    async fn create_group(
        &self,
        user: &common::TestUser,
        name: &str,
        member_ids: &[Uuid],
    ) -> common::TestConversation {
        self.inner.create_group(user, name, member_ids).await
    }

    async fn add_member(
        &self,
        user: &common::TestUser,
        conversation_id: Uuid,
        member_id: Uuid,
    ) -> common::TestMember {
        self.inner
            .add_member(user, conversation_id, member_id)
            .await
    }

    async fn leave_group(&self, user: &common::TestUser, conversation_id: Uuid) {
        self.inner.leave_group(user, conversation_id).await;
    }

    async fn send_message(
        &self,
        user: &common::TestUser,
        conversation_id: Uuid,
        client_msg_id: &str,
        body: &str,
    ) -> nano_chat::messages::types::SendMessageResult {
        self.inner
            .send_message(user, conversation_id, client_msg_id, body)
            .await
    }

    async fn send_direct_message(
        &self,
        user: &common::TestUser,
        target_username: &str,
        client_msg_id: &str,
        body: &str,
    ) -> nano_chat::messages::types::SendMessageResult {
        self.inner
            .send_direct_message(user, target_username, client_msg_id, body)
            .await
    }
}

fn realtime_test_config() -> Config {
    let mut config = common::test_config();
    let database_url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://nano:nano@localhost:5432/nano_chat_test".to_string());
    config.database_url = common::validate_test_database_url(&database_url)
        .expect("TEST_DATABASE_URL must point to a test database");
    config.notify_channel = unique_notify_channel();
    config
}

async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}
