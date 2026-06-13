mod common;

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, tungstenite::protocol::Message as WsMessage,
};

#[tokio::test]
#[serial_test::serial]
async fn real_websocket_direct_message_send_acknowledges_origin_and_fans_out_to_recipient() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind websocket test server");
    let addr = listener.local_addr().expect("read websocket test address");
    let server_app = ctx.app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app)
            .await
            .expect("websocket test server should run");
    });

    let alice_url = format!("ws://{addr}/ws?version=1&token={}", alice.access_token);
    let bob_url = format!("ws://{addr}/ws?version=1&token={}", bob.access_token);
    let (mut alice_ws, _) = connect_async(&alice_url)
        .await
        .expect("alice websocket connects");
    let (mut bob_ws, _) = connect_async(&bob_url)
        .await
        .expect("bob websocket connects");

    bob_ws
        .send(WsMessage::text(
            json!({"id":"bob-ready","type":"heartbeat.ping","payload":{}}).to_string(),
        ))
        .await
        .expect("bob heartbeat sends");
    let bob_ready = next_json(&mut bob_ws).await;
    assert_eq!(bob_ready["type"], "heartbeat.pong");

    alice_ws
        .send(WsMessage::text(
            json!({
                "id": "dm-1",
                "type": "direct_message.send",
                "payload": {
                    "target_username": "bob",
                    "client_msg_id": "ws-dm-1",
                    "body": "hello over real ws"
                }
            })
            .to_string(),
        ))
        .await
        .expect("alice direct_message.send sends");

    let alice_ack = next_json(&mut alice_ws).await;
    assert_eq!(alice_ack["id"], "dm-1");
    assert_eq!(alice_ack["type"], "direct_message.send.ok");
    assert_eq!(alice_ack["payload"]["message"]["message_seq"], 1);

    let bob_event = next_json(&mut bob_ws).await;
    assert_eq!(bob_event["type"], "message.created");
    assert_eq!(bob_event["payload"]["message"]["message_seq"], 1);
    assert_eq!(
        bob_event["payload"]["message"]["body"],
        "hello over real ws"
    );

    let _ = alice_ws.close(None).await;
    let _ = bob_ws.close(None).await;
    server.abort();
}

async fn next_json(ws: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("websocket message should arrive within timeout")
            .expect("websocket stream should stay open")
            .expect("websocket message should be ok");

        match message {
            WsMessage::Text(text) => {
                return serde_json::from_str(text.as_ref()).expect("websocket text should be JSON");
            }
            WsMessage::Close(frame) => {
                panic!("websocket closed before expected message: {frame:?}")
            }
            _ => {}
        }
    }
}
