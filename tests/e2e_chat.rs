mod common;

#[tokio::test]
#[serial_test::serial]
async fn end_to_end_direct_and_group_chat_core_flow() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let direct = ctx.send_direct_message(&alice, "bob", "d1", "hello").await;
    assert_eq!(direct.message.message_seq, 1);

    let group = ctx.create_group(&alice, "team", &[bob.user_id]).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id)
        .await;
    let group_msg = ctx
        .send_message(&bob, group.conversation_id, "g1", "hi team")
        .await;
    assert_eq!(group_msg.message.message_seq, 1);

    ctx.mark_read(&alice, group.conversation_id, 1).await;
    let conversations = ctx.conversations(&alice).await;
    let listed_group = conversations
        .iter()
        .find(|c| c.conversation_id == group.conversation_id)
        .expect("group conversation should be listed for Alice");
    assert_eq!(listed_group.read_seq, 1);
    assert_eq!(listed_group.unread_count, 0);
}
