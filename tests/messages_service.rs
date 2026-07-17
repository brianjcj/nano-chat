mod common;

use axum::http::StatusCode;
use nano_chat::{
    calls::{
        service as calls_service,
        types::{CallInviteOutcome, CallMediaType},
    },
    conversations::service as conversations_service,
    error::ErrorCode,
};
use serde_json::json;
use sqlx::Row;
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn direct_message_creates_or_reuses_direct_conversation_atomically() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let first = ctx
        .send_direct_message(&alice, "bob", "m1", "hello bob")
        .await;
    assert_eq!(first.message.message_seq, 1);

    let second = ctx.send_direct_message(&alice, "bob", "m2", "second").await;
    assert_eq!(second.conversation_id, first.conversation_id);
    assert_eq!(second.message.message_seq, 2);

    let alice_conversations = ctx.conversations(&alice).await;
    let listed = alice_conversations
        .iter()
        .find(|conversation| conversation.conversation_id == first.conversation_id)
        .expect("direct conversation should be listed after first message");
    assert_eq!(listed.conversation_type, "direct");
    assert_eq!(listed.latest_message_seq, 2);
    assert_eq!(listed.active_member_count, 2);
    let direct_user = listed
        .direct_user
        .as_ref()
        .expect("direct list item should include counterpart summary");
    assert_eq!(direct_user.user_id, bob.user_id);
    assert_eq!(direct_user.username, "bob");
    let latest_message = listed
        .latest_message
        .as_ref()
        .expect("direct list item should include latest message summary");
    assert_eq!(latest_message.message_id, second.message.message_id);
    assert_eq!(latest_message.message_seq, 2);
    assert_eq!(latest_message.sender.user_id, alice.user_id);
    assert_eq!(latest_message.body, "second");

    let bob_conversations = ctx.conversations(&bob).await;
    assert!(
        bob_conversations
            .iter()
            .any(|conversation| conversation.conversation_id == first.conversation_id),
        "direct conversation should be listed for the recipient"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn text_messages_return_type_and_empty_metadata() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let _bob = ctx.register("bob").await;

    let sent = ctx
        .send_direct_message(&alice, "bob", "typed-text", "hello")
        .await;
    assert_eq!(sent.message.message_type, "text");
    assert_eq!(sent.message.metadata, serde_json::json!({}));

    let history = ctx.messages(&alice, sent.conversation_id, "").await;
    assert_eq!(history[0].message_type, "text");
    assert_eq!(history[0].metadata, serde_json::json!({}));
}

#[tokio::test]
#[serial_test::serial]
async fn call_event_message_persists_details_and_updates_history() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let seed = ctx
        .send_direct_message(&alice, "bob", "seed-text", "hello before call")
        .await;

    let outcome = calls_service::invite_with_outcome(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        seed.conversation_id,
        CallMediaType::Video,
    )
    .await
    .expect("offline call attempt should be recorded");
    let result = match outcome {
        CallInviteOutcome::Offline(result) => result,
        _ => panic!("offline bob should produce an offline call record"),
    };
    let call_event = result
        .call_event_message
        .as_ref()
        .expect("offline call attempt should create a call event message");
    let metadata = json!({
        "call_id": result.call.call_id,
        "media_type": "video",
        "outcome": "offline",
        "duration_seconds": 0,
        "caller_user_id": alice.user_id,
        "callee_user_id": bob.user_id,
    });

    assert_eq!(call_event.conversation_id, seed.conversation_id);
    assert_eq!(call_event.message_seq, seed.message.message_seq + 1);
    assert_eq!(call_event.body, "视频通话 对方离线");
    assert_eq!(call_event.message_type, "call_event");
    assert_eq!(call_event.metadata, metadata);

    let conversation_row = sqlx::query(
        "select last_message_seq, last_message_id
         from conversations
         where conversation_id = $1",
    )
    .bind(seed.conversation_id)
    .fetch_one(&ctx.pool)
    .await
    .expect("load updated conversation");
    assert_eq!(
        conversation_row.get::<i64, _>("last_message_seq"),
        call_event.message_seq
    );
    assert_eq!(
        conversation_row.get::<uuid::Uuid, _>("last_message_id"),
        call_event.message_id
    );

    let history = ctx.messages(&bob, seed.conversation_id, "").await;
    assert_eq!(history.len(), 2);
    let history_call_event = history.last().expect("call event in history");
    assert_eq!(history_call_event.message_id, call_event.message_id);
    assert_eq!(history_call_event.message_type, "call_event");
    assert_eq!(history_call_event.metadata, metadata);

    let bob_conversations = ctx.conversations(&bob).await;
    let listed = bob_conversations
        .iter()
        .find(|conversation| conversation.conversation_id == seed.conversation_id)
        .expect("conversation should remain listed");
    assert_eq!(listed.latest_message_seq, call_event.message_seq);
    let latest = listed
        .latest_message
        .as_ref()
        .expect("latest message summary");
    assert_eq!(latest.message_id, call_event.message_id);
    assert_eq!(latest.message_type, "call_event");
    assert_eq!(latest.metadata, metadata);
}

#[tokio::test]
#[serial_test::serial]
async fn same_client_msg_id_with_different_body_is_conflict() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let _bob = ctx.register("bob").await;

    ctx.send_direct_message(&alice, "bob", "same-key", "one")
        .await;
    let response = ctx
        .send_direct_message_raw(&alice, "bob", "same-key", "two")
        .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "idempotency_conflict");
}

#[tokio::test]
#[serial_test::serial]
async fn same_client_msg_id_with_same_request_returns_existing_message_without_duplicate() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let _bob = ctx.register("bob").await;

    let first = ctx
        .send_direct_message(&alice, "bob", "repeat-key", "same body")
        .await;
    let second = ctx
        .send_direct_message(&alice, "bob", "repeat-key", "same body")
        .await;

    assert!(first.newly_created(), "first send should insert a message");
    assert!(
        !second.newly_created(),
        "same-key same-request retry should return the existing message"
    );
    assert_eq!(second.conversation_id, first.conversation_id);
    assert_eq!(second.message.message_id, first.message.message_id);
    assert_eq!(second.message.message_seq, first.message.message_seq);

    let count: i64 = sqlx::query_scalar(
        "select count(*) from messages where sender_user_id = $1 and client_id = $2 and client_msg_id = $3",
    )
    .bind(alice.user_id)
    .bind(alice.client_id)
    .bind("repeat-key")
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
#[serial_test::serial]
async fn text_body_trim_empty_is_rejected() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let _bob = ctx.register("bob").await;

    let response = ctx
        .send_direct_message_raw(&alice, "bob", "empty-body", " \n\t ")
        .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "empty_message");
}

#[tokio::test]
#[serial_test::serial]
async fn sender_read_seq_advances_to_sent_message_seq() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let sent = ctx
        .send_direct_message(&alice, "bob", "read-seq", "hello")
        .await;

    let sender_row = sqlx::query(
        "select read_seq from conversation_members where conversation_id = $1 and user_id = $2",
    )
    .bind(sent.conversation_id)
    .bind(alice.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(
        sender_row.get::<i64, _>("read_seq"),
        sent.message.message_seq
    );

    let recipient_row = sqlx::query(
        "select read_seq from conversation_members where conversation_id = $1 and user_id = $2",
    )
    .bind(sent.conversation_id)
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(recipient_row.get::<i64, _>("read_seq"), 0);
}

#[tokio::test]
#[serial_test::serial]
async fn mark_read_beyond_latest_visible_seq_is_invalid_request() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let sent = ctx
        .send_direct_message(&alice, "bob", "read-too-far", "hello")
        .await;

    let error = conversations_service::mark_read(
        &ctx.pool,
        bob.user_id,
        sent.conversation_id,
        sent.message.message_seq + 1,
    )
    .await
    .expect_err("read_seq beyond visible range should be rejected");

    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert_eq!(error.code, ErrorCode::InvalidRequest);
}

#[tokio::test]
#[serial_test::serial]
async fn mark_read_for_former_member_is_limited_to_closed_visibility_span() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.send_message(&alice, group.conversation_id, "visible", "visible to bob")
        .await;
    ctx.leave_group(&bob, group.conversation_id).await;
    ctx.send_message(&alice, group.conversation_id, "hidden", "hidden from bob")
        .await;

    let error = conversations_service::mark_read(&ctx.pool, bob.user_id, group.conversation_id, 2)
        .await
        .expect_err("former member should not mark unreadable messages as read");
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert_eq!(error.code, ErrorCode::InvalidRequest);

    let read_seq =
        conversations_service::mark_read(&ctx.pool, bob.user_id, group.conversation_id, 1)
            .await
            .expect("former member can mark visible messages as read");
    assert_eq!(read_seq, 1);
}

#[tokio::test]
#[serial_test::serial]
async fn group_message_can_be_sent_by_active_member_and_rejected_after_leaving_or_dissolved() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    let sent = ctx
        .send_message(&bob, group.conversation_id, "g1", "hello group")
        .await;
    assert_eq!(sent.message.message_seq, 1);

    ctx.leave_group(&bob, group.conversation_id).await;
    let left_response = ctx
        .send_message_raw(&bob, group.conversation_id, "g2", "after leaving")
        .await;
    assert_eq!(left_response.status(), StatusCode::FORBIDDEN);
    let left_body = common::response_json(left_response).await;
    assert_eq!(left_body["error"]["code"], "not_active_member");

    ctx.leave_group(&alice, group.conversation_id).await;
    let dissolved_response = ctx
        .send_message_raw(&alice, group.conversation_id, "g3", "after dissolve")
        .await;
    assert_eq!(dissolved_response.status(), StatusCode::CONFLICT);
    let dissolved_body = common::response_json(dissolved_response).await;
    assert_eq!(dissolved_body["error"]["code"], "conversation_dissolved");
}

#[tokio::test]
#[serial_test::serial]
async fn group_message_retry_after_sender_leaves_returns_original_message() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    let first = ctx
        .send_message(&bob, group.conversation_id, "g-retry", "hello")
        .await;

    ctx.leave_group(&bob, group.conversation_id).await;
    let response = ctx
        .send_message_raw(&bob, group.conversation_id, "g-retry", "hello")
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let retried: nano_chat::messages::types::SendMessageResult =
        common::response_json_as(response).await;
    assert_eq!(retried.conversation_id, first.conversation_id);
    assert_eq!(
        retried.message.conversation_id,
        first.message.conversation_id
    );
    assert_eq!(retried.message.message_id, first.message.message_id);
    assert_eq!(retried.message.message_seq, first.message.message_seq);
}

#[tokio::test]
#[serial_test::serial]
async fn group_message_retry_after_sender_leaves_with_different_body_is_idempotency_conflict() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.send_message(&bob, group.conversation_id, "g-retry", "hello")
        .await;

    ctx.leave_group(&bob, group.conversation_id).await;
    let response = ctx
        .send_message_raw(&bob, group.conversation_id, "g-retry", "goodbye")
        .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "idempotency_conflict");
}

#[tokio::test]
#[serial_test::serial]
async fn history_filters_group_messages_through_visibility_spans() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.send_message(
        &alice,
        group.conversation_id,
        "before-leave",
        "visible to bob",
    )
    .await;
    ctx.leave_group(&bob, group.conversation_id).await;
    ctx.send_message(
        &alice,
        group.conversation_id,
        "after-leave",
        "hidden from bob",
    )
    .await;

    let bob_messages = ctx.messages(&bob, group.conversation_id, "").await;
    assert_eq!(bob_messages.len(), 1);
    assert_eq!(bob_messages[0].body, "visible to bob");
    assert_eq!(bob_messages[0].message_seq, 1);

    let alice_messages = ctx.messages(&alice, group.conversation_id, "").await;
    assert_eq!(alice_messages.len(), 2);
}

#[tokio::test]
#[serial_test::serial]
async fn visible_user_ids_for_message_uses_message_visibility_spans() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;
    ctx.leave_group(&carol, group.conversation_id).await;

    let sent = ctx
        .send_message(&bob, group.conversation_id, "seq-1", "hello before rejoin")
        .await;
    assert_eq!(sent.message.message_seq, 1);

    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;

    let visible_user_ids = conversations_service::visible_user_ids_for_message(
        &ctx.pool,
        group.conversation_id,
        sent.message.message_seq,
    )
    .await
    .expect("visible user ids should load");

    assert!(visible_user_ids.contains(&alice.user_id));
    assert!(visible_user_ids.contains(&bob.user_id));
    assert!(!visible_user_ids.contains(&carol.user_id));
    assert_eq!(visible_user_ids.len(), 2);
}

#[tokio::test]
#[serial_test::serial]
async fn visible_user_ids_for_message_works_after_group_is_dissolved() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    let sent = ctx
        .send_message(&alice, group.conversation_id, "seq-1", "history survives")
        .await;
    assert_eq!(sent.message.message_seq, 1);

    ctx.leave_group(&bob, group.conversation_id).await;
    ctx.leave_group(&alice, group.conversation_id).await;

    let visible_user_ids = conversations_service::visible_user_ids_for_message(
        &ctx.pool,
        group.conversation_id,
        sent.message.message_seq,
    )
    .await
    .expect("visible user ids should load for dissolved groups");

    assert!(visible_user_ids.contains(&alice.user_id));
    assert!(visible_user_ids.contains(&bob.user_id));
    assert_eq!(visible_user_ids.len(), 2);
}

#[tokio::test]
#[serial_test::serial]
async fn http_history_endpoint_returns_current_sender_summary_and_paginates_by_seq() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let first = ctx.send_direct_message(&alice, "bob", "h1", "first").await;
    ctx.send_direct_message(&alice, "bob", "h2", "second").await;
    ctx.send_direct_message(&alice, "bob", "h3", "third").await;

    ctx.update_display_name(&alice, Some("Alice Renamed")).await;

    let after_page = ctx
        .messages(&bob, first.conversation_id, "after_seq=1&limit=1")
        .await;
    assert_eq!(after_page.len(), 1);
    assert_eq!(after_page[0].message_seq, 2);
    assert_eq!(after_page[0].body, "second");
    assert_eq!(after_page[0].sender.user_id, alice.user_id);
    assert_eq!(after_page[0].sender.username, "alice");
    assert_eq!(
        after_page[0].sender.display_name.as_deref(),
        Some("Alice Renamed")
    );

    let before_page = ctx
        .messages(&bob, first.conversation_id, "before_seq=3&limit=1")
        .await;
    assert_eq!(before_page.len(), 1);
    assert_eq!(before_page[0].message_seq, 2);
}

#[tokio::test]
#[serial_test::serial]
async fn malformed_history_query_uses_invalid_request_error_envelope() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    let response = ctx
        .messages_raw(&alice, group.conversation_id, "after_seq=not-a-number")
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "invalid_request");
}

#[tokio::test]
#[serial_test::serial]
async fn malformed_history_path_uses_invalid_request_error_envelope() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let request =
        common::authed_empty_request("GET", "/api/v1/conversations/not-a-uuid/messages", &alice);

    let response = ctx.app.clone().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "invalid_request");
}

#[tokio::test]
#[serial_test::serial]
async fn no_public_http_send_endpoint_is_exposed() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    let request = common::authed_json_request(
        "POST",
        &format!("/api/v1/conversations/{}/messages", group.conversation_id),
        &alice,
        json!({"client_msg_id": "http-send", "body": "not over http"}),
    );

    let response = ctx.app.clone().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}
