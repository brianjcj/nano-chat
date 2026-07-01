mod common;

use nano_chat::{
    calls::{service as calls_service, types::CallMediaType},
    error::ErrorCode,
};

#[tokio::test]
#[serial_test::serial]
async fn invite_requires_active_direct_conversation_and_online_callee() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    let group = ctx.create_group(&alice, "team", &[bob.user_id]).await;

    let offline = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .expect_err("offline callee should fail");
    assert_eq!(offline.code, ErrorCode::CalleeOffline);

    let group_error = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        group.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect_err("group calls are not supported");
    assert_eq!(group_error.code, ErrorCode::InvalidRequest);
}

#[tokio::test]
#[serial_test::serial]
async fn busy_lock_allows_only_one_non_ended_call_per_user() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;
    let alice_bob = ctx.send_direct_message(&alice, "bob", "ab", "hello").await;
    let carol_bob = ctx.send_direct_message(&carol, "bob", "cb", "hello").await;
    ctx.register_ws_sender_for(&bob);

    let first = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        alice_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect("first call should start");

    let busy = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        carol.current_user(),
        carol_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect_err("bob should be globally busy");
    assert_eq!(busy.code, ErrorCode::CallBusy);

    let active_rows: i64 = sqlx::query_scalar(
        "select count(*) from call_participants where user_id = $1 and state in ('ringing', 'connecting', 'active')",
    )
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(active_rows, 1);
    assert_eq!(first.call.callee.user_id, bob.user_id);
}
