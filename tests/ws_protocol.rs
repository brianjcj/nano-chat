use nano_chat::ws::protocol::{ClientEnvelope, ServerEnvelope};
use serde_json::json;

#[test]
fn parses_message_send_envelope_with_snake_case_payload() {
    let raw = json!({
        "id": "req-1",
        "type": "message.send",
        "payload": {
            "conversation_id": "018f0000-0000-7000-8000-000000000001",
            "client_msg_id": "c1",
            "body": "hello"
        }
    });
    let parsed: ClientEnvelope = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.id.as_deref(), Some("req-1"));
    assert_eq!(parsed.message_type, "message.send");
}

#[test]
fn heartbeat_ping_may_omit_id() {
    let raw = json!({"type":"heartbeat.ping","payload":{"client_time":"2026-06-13T00:00:00Z"}});
    let parsed: ClientEnvelope = serde_json::from_value(raw).unwrap();
    assert!(parsed.id.is_none());
    assert_eq!(parsed.message_type, "heartbeat.ping");
}

#[test]
fn ok_envelope_uses_request_id_type_and_payload() {
    let env = ServerEnvelope::ok(
        Some("req-1".to_string()),
        "message.send.ok",
        json!({"message_seq": 1}),
    );
    let value = serde_json::to_value(env).unwrap();
    assert_eq!(value["id"], "req-1");
    assert_eq!(value["type"], "message.send.ok");
    assert_eq!(value["payload"]["message_seq"], 1);
    assert!(value.get("error").is_none());
}

#[test]
fn event_envelope_has_no_request_id() {
    let env = ServerEnvelope::event("message.created", json!({"message_seq": 1}));
    let value = serde_json::to_value(env).unwrap();
    assert!(value.get("id").is_none());
    assert_eq!(value["type"], "message.created");
    assert_eq!(value["payload"]["message_seq"], 1);
}

#[test]
fn error_envelope_uses_stable_code() {
    let env = ServerEnvelope::error(
        Some("req-1".to_string()),
        nano_chat::error::ErrorCode::InvalidWsEnvelope,
        "Invalid envelope",
    );
    let value = serde_json::to_value(env).unwrap();
    assert_eq!(value["type"], "error");
    assert_eq!(value["error"]["code"], "invalid_ws_envelope");
}
