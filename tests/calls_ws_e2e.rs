mod common;

use std::{net::SocketAddr, time::Duration};

use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, tungstenite::protocol::Message as WsMessage,
};

#[tokio::test]
#[serial_test::serial]
async fn call_invite_rings_all_callee_clients_and_accept_targets_signal() {
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

    let alice_ack = alice_ws.next_json().await;
    assert_eq!(alice_ack["type"], "call.invite.ok");
    let call_id = alice_ack["payload"]["call"]["call_id"]
        .as_str()
        .unwrap()
        .to_string();

    assert_eq!(bob_phone_ws.next_json().await["type"], "call.incoming");
    assert_eq!(bob_desktop_ws.next_json().await["type"], "call.incoming");

    bob_desktop_ws
        .send_json(json!({"id":"accept-1", "type":"call.accept", "payload":{"call_id": call_id}}))
        .await;
    assert_eq!(bob_desktop_ws.next_json().await["type"], "call.accept.ok");
    assert_eq!(bob_phone_ws.next_json().await["type"], "call.accepted");

    alice_ws
        .send_json(json!({
            "id":"signal-1",
            "type":"call.signal",
            "payload":{"call_id": call_id, "signal_type":"offer", "data":{"type":"offer", "sdp":"v=0"}}
        }))
        .await;
    assert_eq!(alice_ws.next_json().await["type"], "call.signal.ok");
    let signal = bob_desktop_ws.next_json().await;
    assert_eq!(signal["type"], "call.signal");
    assert_eq!(signal["payload"]["signal_type"], "offer");

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

async fn connect_user(
    addr: &SocketAddr,
    user: &common::TestUser,
) -> WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
    let url = format!("ws://{addr}/ws?version=1&token={}", user.access_token);
    let (ws, _) = connect_async(&url).await.expect("user websocket connects");
    ws
}

trait JsonWebSocketExt {
    async fn send_json(&mut self, value: Value);
    async fn next_json(&mut self) -> Value;
}

impl JsonWebSocketExt for WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
    async fn send_json(&mut self, value: Value) {
        self.send(WsMessage::text(value.to_string()))
            .await
            .expect("websocket JSON sends");
    }

    async fn next_json(&mut self) -> Value {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(2), self.next())
                .await
                .expect("websocket message should arrive within timeout")
                .expect("websocket stream should stay open")
                .expect("websocket message should be ok");

            match message {
                WsMessage::Text(text) => {
                    return serde_json::from_str(text.as_ref())
                        .expect("websocket text should be JSON");
                }
                WsMessage::Close(frame) => {
                    panic!("websocket closed before expected message: {frame:?}")
                }
                _ => {}
            }
        }
    }
}
