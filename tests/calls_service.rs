mod common;

use nano_chat::{
    calls::{
        service as calls_service,
        types::{CallEndReason, CallInviteOutcome, CallMediaType, CallState},
    },
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

#[tokio::test]
#[serial_test::serial]
async fn invite_with_outcome_returns_busy_summary_for_callee_busy() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;
    let alice_bob = ctx.send_direct_message(&alice, "bob", "ab", "hello").await;
    let carol_bob = ctx.send_direct_message(&carol, "bob", "cb", "hello").await;
    ctx.register_ws_sender_for(&bob);

    calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        alice_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect("first call should start");

    let outcome = calls_service::invite_with_outcome(
        &ctx.pool,
        &ctx.state.registry,
        carol.current_user(),
        carol_bob.conversation_id,
        CallMediaType::Video,
    )
    .await
    .expect("callee-busy attempt should expose the recorded busy call");

    let busy = match outcome {
        CallInviteOutcome::Busy(result) => result,
        CallInviteOutcome::Started(_) => panic!("busy callee should not start a call"),
    };
    assert_eq!(busy.call.caller.user_id, carol.user_id);
    assert_eq!(busy.call.callee.user_id, bob.user_id);
    assert_eq!(busy.call.state, CallState::Ended);
    assert_eq!(busy.call.end_reason, Some(CallEndReason::Busy));
}

#[tokio::test]
#[serial_test::serial]
async fn signal_target_rejects_non_origin_caller_client() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let alice_other = ctx.login_existing_client("alice", None).await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .expect("call should start");
    calls_service::accept(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .expect("callee should accept");

    let rejected =
        calls_service::signal_target(&ctx.pool, &alice_other.current_user(), invited.call.call_id)
            .await
            .expect_err("non-origin caller client must not signal");
    assert_eq!(rejected.code, ErrorCode::NotCallParticipant);

    let target =
        calls_service::signal_target(&ctx.pool, &alice.current_user(), invited.call.call_id)
            .await
            .expect("origin caller client should signal accepted callee");
    assert_eq!(target.target_user_id, bob.user_id);
    assert_eq!(target.target_client_id, bob.client_id);
}

#[tokio::test]
#[serial_test::serial]
async fn accept_connected_and_hangup_complete_call_with_duration_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .unwrap();

    let accepted = calls_service::accept(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .unwrap();
    assert_eq!(accepted.call.accepted_client_id, Some(bob.client_id));

    let active = calls_service::connected(&ctx.pool, alice.current_user(), invited.call.call_id)
        .await
        .unwrap();
    assert_eq!(
        active.call.state,
        nano_chat::calls::types::CallState::Active
    );

    let ended = calls_service::hangup(
        &ctx.pool,
        alice.current_user(),
        invited.call.call_id,
        nano_chat::calls::types::CallEndReason::Completed,
    )
    .await
    .unwrap();
    assert_eq!(
        ended.call.end_reason,
        Some(nano_chat::calls::types::CallEndReason::Completed)
    );

    let history = ctx.messages(&alice, direct.conversation_id, "").await;
    let call_event = history
        .iter()
        .find(|message| message.message_type == "call_event")
        .unwrap();
    assert_eq!(
        call_event.metadata["call_id"],
        invited.call.call_id.to_string()
    );
    assert_eq!(call_event.metadata["media_type"], "video");
    assert_eq!(call_event.metadata["outcome"], "completed");
    assert!(call_event.metadata["duration_seconds"].as_i64().unwrap() >= 0);
}

#[tokio::test]
#[serial_test::serial]
async fn reject_cancel_and_duplicate_end_create_one_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .unwrap();

    calls_service::reject(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .unwrap();
    calls_service::reject(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .unwrap();

    let record_count: i64 = sqlx::query_scalar(
        "select count(*) from messages where conversation_id = $1 and message_type = 'call_event'",
    )
    .bind(direct.conversation_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(record_count, 1);
}

#[tokio::test]
#[serial_test::serial]
async fn cancel_duplicate_end_create_one_canceled_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .unwrap();

    let canceled = calls_service::cancel(&ctx.pool, alice.current_user(), invited.call.call_id)
        .await
        .unwrap();
    assert_eq!(
        canceled.call.end_reason,
        Some(nano_chat::calls::types::CallEndReason::Canceled)
    );
    calls_service::cancel(&ctx.pool, alice.current_user(), invited.call.call_id)
        .await
        .unwrap();

    let history = ctx.messages(&alice, direct.conversation_id, "").await;
    let call_events: Vec<_> = history
        .iter()
        .filter(|message| message.message_type == "call_event")
        .collect();
    assert_eq!(call_events.len(), 1);
    assert_eq!(call_events[0].metadata["outcome"], "canceled");
}

#[tokio::test]
#[serial_test::serial]
async fn hangup_and_reinvite_same_direct_conversation_do_not_deadlock() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .unwrap();
    calls_service::accept(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .unwrap();
    calls_service::connected(&ctx.pool, alice.current_user(), invited.call.call_id)
        .await
        .unwrap();

    drop_call_participant_sleep_trigger(&ctx.pool).await;
    install_call_participant_sleep_trigger(&ctx.pool).await;

    let mut hangup_handle = {
        let pool = ctx.pool.clone();
        let actor = alice.current_user();
        let call_id = invited.call.call_id;
        tokio::spawn(async move {
            calls_service::hangup(&pool, actor, call_id, CallEndReason::Completed).await
        })
    };

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let mut reinvite_handle = {
        let pool = ctx.pool.clone();
        let registry = ctx.state.registry.clone();
        let actor = alice.current_user();
        let conversation_id = direct.conversation_id;
        tokio::spawn(async move {
            calls_service::invite(
                &pool,
                &registry,
                actor,
                conversation_id,
                CallMediaType::Audio,
            )
            .await
        })
    };

    let joined = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        tokio::join!(&mut hangup_handle, &mut reinvite_handle)
    })
    .await;
    if joined.is_err() {
        hangup_handle.abort();
        reinvite_handle.abort();
    }
    drop_call_participant_sleep_trigger(&ctx.pool).await;

    let (hangup_result, reinvite_result) = joined.expect("hangup plus reinvite should not hang");
    let ended = hangup_result
        .expect("hangup task should join")
        .expect("hangup should not deadlock");
    let reinvited = reinvite_result
        .expect("reinvite task should join")
        .expect("reinvite should wait for hangup and then start");

    assert_eq!(ended.call.end_reason, Some(CallEndReason::Completed));
    assert_ne!(reinvited.call.call_id, invited.call.call_id);

    let call_event_count: i64 = sqlx::query_scalar(
        "select count(*) from messages where conversation_id = $1 and message_type = 'call_event'",
    )
    .bind(direct.conversation_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(call_event_count, 1);
}

async fn install_call_participant_sleep_trigger(pool: &sqlx::PgPool) {
    sqlx::query(
        "create or replace function test_sleep_call_participants_end()
         returns trigger as $$
         begin
             perform pg_sleep(1.0);
             return null;
         end;
         $$ language plpgsql",
    )
    .execute(pool)
    .await
    .expect("install call participant sleep function");

    sqlx::query(
        "create trigger test_sleep_call_participants_end
         after update of state on call_participants
         for each statement
         execute function test_sleep_call_participants_end()",
    )
    .execute(pool)
    .await
    .expect("install call participant sleep trigger");
}

async fn drop_call_participant_sleep_trigger(pool: &sqlx::PgPool) {
    sqlx::query("drop trigger if exists test_sleep_call_participants_end on call_participants")
        .execute(pool)
        .await
        .expect("drop call participant sleep trigger");
    sqlx::query("drop function if exists test_sleep_call_participants_end()")
        .execute(pool)
        .await
        .expect("drop call participant sleep function");
}
