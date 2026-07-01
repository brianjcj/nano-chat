mod common;

use std::{net::SocketAddr, time::Duration};

use axum::Router;
use futures_util::{SinkExt, StreamExt};
use nano_chat::calls::{service as calls_service, types::CallMediaType};
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, tungstenite::protocol::Message as WsMessage,
};

type TestWebSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
#[serial_test::serial]
async fn call_invite_emits_ringing_and_accept_reaches_caller_and_losing_callee() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob_phone = ctx.register("bob").await;
    let bob_desktop = ctx.login_existing_client("bob", None).await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    let (addr, server) = spawn_ws_server(ctx.app.clone()).await;

    let mut alice_ws = connect_user(&addr, &alice).await;
    let mut bob_phone_ws = connect_user(&addr, &bob_phone).await;
    let mut bob_desktop_ws = connect_user(&addr, &bob_desktop).await;

    alice_ws
        .send_json(json!({
            "id":"invite-1",
            "type":"call.invite",
            "payload":{"conversation_id": direct.conversation_id, "media_type":"video"}
        }))
        .await;

    let alice_ack = assert_next_type(&mut alice_ws, "call.invite.ok").await;
    let call_id = alice_ack["payload"]["call"]["call_id"]
        .as_str()
        .unwrap()
        .to_string();

    let alice_ringing = assert_next_type(&mut alice_ws, "call.ringing").await;
    assert_eq!(alice_ringing["payload"]["call"]["call_id"], call_id);
    assert_eq!(bob_phone_ws.next_json().await["type"], "call.incoming");
    assert_eq!(bob_desktop_ws.next_json().await["type"], "call.incoming");

    bob_desktop_ws
        .send_json(json!({"id":"accept-1", "type":"call.accept", "payload":{"call_id": call_id}}))
        .await;
    assert_next_type(&mut bob_desktop_ws, "call.accept.ok").await;
    assert_next_type(&mut bob_phone_ws, "call.accepted").await;
    let alice_accepted = assert_next_type(&mut alice_ws, "call.accepted").await;
    assert_eq!(alice_accepted["payload"]["call"]["call_id"], call_id);

    server.abort();
}

#[tokio::test]
#[serial_test::serial]
async fn call_signal_is_limited_to_origin_caller_and_accepted_callee_client() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let alice_other = ctx.login_existing_client("alice", None).await;
    let bob_phone = ctx.register("bob").await;
    let bob_desktop = ctx.login_existing_client("bob", None).await;
    let direct = ctx
        .send_direct_message(&alice, "bob", "seed", "hello")
        .await;
    let (addr, server) = spawn_ws_server(ctx.app.clone()).await;

    let mut alice_ws = connect_user(&addr, &alice).await;
    let mut alice_other_ws = connect_user(&addr, &alice_other).await;
    let mut bob_phone_ws = connect_user(&addr, &bob_phone).await;
    let mut bob_desktop_ws = connect_user(&addr, &bob_desktop).await;

    alice_ws
        .send_json(json!({
            "id":"invite-1",
            "type":"call.invite",
            "payload":{"conversation_id": direct.conversation_id, "media_type":"video"}
        }))
        .await;

    let alice_ack = assert_next_type(&mut alice_ws, "call.invite.ok").await;
    let call_id = alice_ack["payload"]["call"]["call_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_next_type(&mut alice_ws, "call.ringing").await;
    assert_next_type(&mut alice_other_ws, "call.ringing").await;
    assert_next_type(&mut bob_phone_ws, "call.incoming").await;
    assert_next_type(&mut bob_desktop_ws, "call.incoming").await;

    bob_desktop_ws
        .send_json(json!({"id":"accept-1", "type":"call.accept", "payload":{"call_id": call_id}}))
        .await;
    assert_next_type(&mut bob_desktop_ws, "call.accept.ok").await;
    assert_next_type(&mut bob_phone_ws, "call.accepted").await;
    assert_next_type(&mut alice_ws, "call.accepted").await;
    assert_next_type(&mut alice_other_ws, "call.accepted").await;

    bob_phone_ws
        .send_json(json!({
            "id":"callee-signal-1",
            "type":"call.signal",
            "payload":{"call_id": call_id, "signal_type":"answer", "data":{"type":"answer", "sdp":"v=0"}}
        }))
        .await;
    let callee_error = assert_next_type(&mut bob_phone_ws, "error").await;
    assert_eq!(callee_error["error"]["code"], "not_call_participant");

    alice_other_ws
        .send_json(json!({
            "id":"non-origin-signal-1",
            "type":"call.signal",
            "payload":{"call_id": call_id, "signal_type":"offer", "data":{"type":"offer", "sdp":"v=0"}}
        }))
        .await;
    let caller_error = assert_next_type(&mut alice_other_ws, "error").await;
    assert_eq!(caller_error["error"]["code"], "not_call_participant");
    assert_no_json(&mut bob_desktop_ws).await;

    alice_ws
        .send_json(json!({
            "id":"signal-1",
            "type":"call.signal",
            "payload":{"call_id": call_id, "signal_type":"offer", "data":{"type":"offer", "sdp":"v=0"}}
        }))
        .await;
    assert_next_type(&mut alice_ws, "call.signal.ok").await;
    let signal = assert_next_type(&mut bob_desktop_ws, "call.signal").await;
    assert_eq!(signal["payload"]["signal_type"], "offer");
    assert_no_json(&mut bob_phone_ws).await;

    server.abort();
}

#[tokio::test]
#[serial_test::serial]
async fn call_busy_is_emitted_for_callee_busy_invite_attempt() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;
    let alice_bob = ctx
        .send_direct_message(&alice, "bob", "alice-bob", "hello bob")
        .await;
    let carol_bob = ctx
        .send_direct_message(&carol, "bob", "carol-bob", "hello bob")
        .await;
    let (addr, server) = spawn_ws_server(ctx.app.clone()).await;

    let _bob_ws = connect_user(&addr, &bob).await;
    let mut carol_ws = connect_user(&addr, &carol).await;

    calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        alice_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect("first call should make bob busy");

    carol_ws
        .send_json(json!({
            "id":"busy-invite-1",
            "type":"call.invite",
            "payload":{"conversation_id": carol_bob.conversation_id, "media_type":"video"}
        }))
        .await;

    let error = assert_next_type(&mut carol_ws, "error").await;
    assert_eq!(error["id"], "busy-invite-1");
    assert_eq!(error["error"]["code"], "call_busy");
    let busy = assert_next_type(&mut carol_ws, "call.busy").await;
    assert_eq!(
        busy["payload"]["call"]["caller"]["user_id"],
        json!(carol.user_id)
    );
    assert_eq!(
        busy["payload"]["call"]["callee"]["user_id"],
        json!(bob.user_id)
    );
    assert_eq!(busy["payload"]["call"]["state"], "ended");
    assert_eq!(busy["payload"]["call"]["end_reason"], "busy");

    server.abort();
}

async fn spawn_ws_server(app: Router) -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind websocket test server");
    let addr = listener.local_addr().expect("read websocket test address");
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("websocket test server should run");
    });
    (addr, server)
}

async fn connect_user(addr: &SocketAddr, user: &common::TestUser) -> TestWebSocket {
    let url = format!("ws://{addr}/ws?version=1&token={}", user.access_token);
    let (ws, _) = connect_async(&url).await.expect("user websocket connects");
    ws
}

async fn assert_next_type(ws: &mut TestWebSocket, expected_type: &str) -> Value {
    let envelope = ws.next_json().await;
    assert_eq!(envelope["type"], expected_type);
    envelope
}

async fn assert_no_json(ws: &mut TestWebSocket) {
    if let Some(envelope) = ws.next_json_within(Duration::from_millis(250)).await {
        panic!("unexpected websocket message: {envelope}");
    }
}

trait JsonWebSocketExt {
    async fn send_json(&mut self, value: Value);
    async fn next_json(&mut self) -> Value;
    async fn next_json_within(&mut self, timeout_duration: Duration) -> Option<Value>;
}

impl JsonWebSocketExt for TestWebSocket {
    async fn send_json(&mut self, value: Value) {
        self.send(WsMessage::text(value.to_string()))
            .await
            .expect("websocket JSON sends");
    }

    async fn next_json(&mut self) -> Value {
        self.next_json_within(Duration::from_secs(2))
            .await
            .expect("websocket message should arrive within timeout")
    }

    async fn next_json_within(&mut self, timeout_duration: Duration) -> Option<Value> {
        loop {
            let message = match tokio::time::timeout(timeout_duration, self.next()).await {
                Ok(Some(message)) => message.expect("websocket message should be ok"),
                Ok(None) => panic!("websocket stream closed before expected message"),
                Err(_) => return None,
            };

            match message {
                WsMessage::Text(text) => {
                    return Some(
                        serde_json::from_str(text.as_ref()).expect("websocket text should be JSON"),
                    );
                }
                WsMessage::Close(frame) => {
                    panic!("websocket closed before expected message: {frame:?}")
                }
                _ => {}
            }
        }
    }
}
