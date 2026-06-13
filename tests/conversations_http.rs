mod common;

use axum::http::StatusCode;
use sqlx::Row;
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn group_create_add_leave_rejoin_and_dissolve_follow_visibility_rules() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    assert_eq!(group.name.as_deref(), Some("project"));

    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;
    ctx.leave_group(&carol, group.conversation_id).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;

    let members = ctx.group_members(&alice, group.conversation_id).await;
    assert!(members.iter().any(|m| m.user_id == alice.user_id));
    assert!(members.iter().any(|m| m.user_id == bob.user_id));
    assert!(members.iter().any(|m| m.user_id == carol.user_id));
}

#[tokio::test]
#[serial_test::serial]
async fn group_creation_requires_creator_plus_one_member() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let response = ctx.create_group_raw(&alice, "solo", &[]).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
#[serial_test::serial]
async fn malformed_conversation_id_path_uses_invalid_request_error_envelope() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let request =
        common::authed_empty_request("GET", "/api/v1/conversations/not-a-uuid/members", &alice);

    let response = ctx.app.clone().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "invalid_request");
}

#[tokio::test]
#[serial_test::serial]
async fn default_conversation_list_includes_active_empty_groups_for_active_members() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;

    let alice_conversations = ctx.conversations(&alice).await;
    let bob_conversations = ctx.conversations(&bob).await;

    for conversations in [&alice_conversations, &bob_conversations] {
        let listed = conversations
            .iter()
            .find(|conversation| conversation.conversation_id == group.conversation_id)
            .expect("active empty group should be listed");
        assert_eq!(listed.conversation_type, "group");
        assert_eq!(listed.state, "active");
        assert_eq!(listed.latest_message_seq, 0);
        assert_eq!(listed.read_seq, 0);
        assert_eq!(listed.unread_count, 0);
        assert_eq!(listed.active_member_count, 2);
    }
}

#[tokio::test]
#[serial_test::serial]
async fn after_member_leaves_group_disappears_from_former_members_default_list() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.leave_group(&bob, group.conversation_id).await;

    let bob_conversations = ctx.conversations(&bob).await;
    assert!(
        bob_conversations
            .iter()
            .all(|conversation| conversation.conversation_id != group.conversation_id),
        "left group should not be in former member's default list"
    );

    let alice_conversations = ctx.conversations(&alice).await;
    let listed = alice_conversations
        .iter()
        .find(|conversation| conversation.conversation_id == group.conversation_id)
        .expect("group should remain listed for active members");
    assert_eq!(listed.active_member_count, 1);
}

#[tokio::test]
#[serial_test::serial]
async fn last_active_member_leaving_dissolves_group_and_prevents_modification() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.leave_group(&bob, group.conversation_id).await;
    ctx.leave_group(&alice, group.conversation_id).await;

    let response = ctx
        .add_member_raw(&alice, group.conversation_id, carol.user_id)
        .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = common::response_json(response).await;
    assert_eq!(body["error"]["code"], "conversation_dissolved");

    let row =
        sqlx::query("select state, dissolved_at from conversations where conversation_id = $1")
            .bind(group.conversation_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(row.get::<String, _>("state"), "dissolved");
    assert!(
        row.try_get::<chrono::DateTime<chrono::Utc>, _>("dissolved_at")
            .is_ok()
    );
}

#[tokio::test]
#[serial_test::serial]
async fn rejoining_creates_new_open_span_and_advances_read_seq_to_current_last_message_seq() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    ctx.leave_group(&bob, group.conversation_id).await;
    ctx.add_member(&alice, group.conversation_id, bob.user_id)
        .await;

    let member_row = sqlx::query(
        "select state, read_seq from conversation_members where conversation_id = $1 and user_id = $2",
    )
    .bind(group.conversation_id)
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(member_row.get::<String, _>("state"), "active");
    assert_eq!(member_row.get::<i64, _>("read_seq"), 0);

    let open_span_count: i64 = sqlx::query_scalar(
        "select count(*) from conversation_member_spans where conversation_id = $1 and user_id = $2 and to_seq is null",
    )
    .bind(group.conversation_id)
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(open_span_count, 1);

    let total_span_count: i64 = sqlx::query_scalar(
        "select count(*) from conversation_member_spans where conversation_id = $1 and user_id = $2",
    )
    .bind(group.conversation_id)
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(total_span_count, 2);
}
