use std::time::Duration as StdDuration;

use axum::{
    extract::{
        Query, State,
        rejection::QueryRejection,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::Response,
};
use chrono::Duration as ChronoDuration;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::{service as auth_service, types::CurrentUser},
    conversations::service as conversations_service,
    error::{AppError, AppResult, ErrorCode},
    messages::{
        service as messages_service,
        types::{DirectTarget, MessageDto},
    },
    realtime::types::ConnectionId,
    time::{now_utc, to_rfc3339_utc},
    ws::protocol::{
        ClientEnvelope, ConversationReadPayload, DirectMessageSendPayload, HeartbeatPingPayload,
        MessageSendPayload, ServerEnvelope,
    },
};

const OUTBOUND_CHANNEL_CAPACITY: usize = 100;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub version: Option<String>,
    pub token: Option<String>,
}

pub async fn ws_handler(
    State(state): State<AppState>,
    query: Result<Query<WsQuery>, QueryRejection>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> AppResult<Response> {
    let Query(query) = query.map_err(AppError::from_query_rejection)?;
    if query.version.as_deref() != Some("1") {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::UnsupportedWsVersion,
            "Unsupported WebSocket version",
        ));
    }

    let token_authorization = query.token.as_ref().map(|token| format!("Bearer {token}"));
    let header_authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let authorization = token_authorization.as_deref().or(header_authorization);
    let current_user =
        auth_service::authenticate_bearer(&state.pool, &state.config, authorization).await?;

    if state.registry.is_user_at_limit(current_user.user_id) {
        return Err(too_many_connections_error());
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, current_user)))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, current_user: CurrentUser) {
    let (outbound_tx, outbound_rx) = mpsc::channel(OUTBOUND_CHANNEL_CAPACITY);
    let registered = match state.registry.register(
        current_user.user_id,
        current_user.client_id,
        outbound_tx.clone(),
    ) {
        Ok(registered) => registered,
        Err(_) => {
            send_envelope_to_socket(
                &mut socket,
                ServerEnvelope::error(
                    None,
                    ErrorCode::TooManyConnections,
                    "Too many active WebSocket connections",
                ),
            )
            .await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    let connection_id = registered.connection_id;
    let (mut socket_sender, mut socket_receiver) = socket.split();
    let mut writer = tokio::spawn(async move {
        let mut outbound_rx = outbound_rx;
        while let Some(envelope) = outbound_rx.recv().await {
            let Ok(text) = serde_json::to_string(&envelope) else {
                continue;
            };
            if socket_sender
                .send(Message::Text(text.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let cleanup_interval_secs = state.config.heartbeat_interval_secs.max(1);
    let idle_timeout = ChronoDuration::from_std(StdDuration::from_secs(
        state.config.heartbeat_idle_timeout_secs.max(1),
    ))
    .unwrap_or_else(|_| ChronoDuration::seconds(90));
    let mut cleanup_interval = tokio::time::interval(StdDuration::from_secs(cleanup_interval_secs));

    loop {
        tokio::select! {
            incoming = socket_receiver.next() => {
                let Some(incoming) = incoming else {
                    break;
                };

                match incoming {
                    Ok(message) => {
                        if !handle_incoming_message(
                            message,
                            &state,
                            &current_user,
                            connection_id,
                            &outbound_tx,
                        )
                        .await
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        tracing::debug!(%error, %connection_id, "websocket receive failed");
                        break;
                    }
                }
            }
            _ = cleanup_interval.tick() => {
                let removed = state.registry.cleanup_idle(now_utc(), idle_timeout);
                if removed.contains(&connection_id) || !state.registry.contains(connection_id) {
                    let _ = outbound_tx.try_send(ServerEnvelope::error(
                        None,
                        ErrorCode::HeartbeatTimeout,
                        "WebSocket heartbeat timed out",
                    ));
                    break;
                }
            }
        }
    }

    state.registry.unregister(connection_id);
    drop(outbound_tx);
    tokio::select! {
        _ = &mut writer => {}
        _ = tokio::time::sleep(StdDuration::from_millis(100)) => {
            writer.abort();
        }
    }
}

async fn handle_incoming_message(
    message: Message,
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
) -> bool {
    match message {
        Message::Text(text) => {
            if text.as_str().len() > state.config.max_ws_payload_bytes {
                send_and_close(
                    outbound_tx,
                    None,
                    ErrorCode::WsPayloadTooLarge,
                    "WebSocket payload exceeds the maximum size",
                );
                return false;
            }

            let envelope = match serde_json::from_str::<ClientEnvelope>(text.as_str()) {
                Ok(envelope) => envelope,
                Err(_) => {
                    send_and_close(
                        outbound_tx,
                        None,
                        ErrorCode::InvalidWsEnvelope,
                        "Invalid WebSocket envelope",
                    );
                    return false;
                }
            };

            if !state.registry.touch(connection_id) {
                send_and_close(
                    outbound_tx,
                    None,
                    ErrorCode::HeartbeatTimeout,
                    "WebSocket heartbeat timed out",
                );
                return false;
            }

            dispatch_client_envelope(state, current_user, connection_id, outbound_tx, envelope)
                .await
        }
        Message::Binary(bytes) => {
            let code = if bytes.len() > state.config.max_ws_payload_bytes {
                ErrorCode::WsPayloadTooLarge
            } else {
                ErrorCode::InvalidWsEnvelope
            };
            let message = if code == ErrorCode::WsPayloadTooLarge {
                "WebSocket payload exceeds the maximum size"
            } else {
                "WebSocket envelope must be JSON text"
            };
            send_and_close(outbound_tx, None, code, message);
            false
        }
        Message::Ping(_) | Message::Pong(_) => true,
        Message::Close(_) => false,
    }
}

async fn dispatch_client_envelope(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    match envelope.message_type.as_str() {
        "message.send" => {
            handle_message_send(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "direct_message.send" => {
            handle_direct_message_send(state, current_user, connection_id, outbound_tx, envelope)
                .await
        }
        "conversation.read" => {
            handle_conversation_read(state, current_user, outbound_tx, envelope).await
        }
        "heartbeat.ping" => handle_heartbeat_ping(outbound_tx, envelope),
        _ => {
            send_and_close(
                outbound_tx,
                envelope.id,
                ErrorCode::InvalidWsEnvelope,
                "Unsupported WebSocket command",
            );
            false
        }
    }
}

async fn handle_message_send(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<MessageSendPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message);
            return false;
        }
    };

    match messages_service::send_message(
        &state.pool,
        current_user.clone(),
        payload.conversation_id,
        payload.client_msg_id,
        payload.body,
    )
    .await
    {
        Ok(result) => {
            let newly_created = result.newly_created;
            send_ok(outbound_tx, id, "message.send.ok", json!(result));
            if newly_created {
                fanout_message_created(
                    state,
                    result.conversation_id,
                    result.message,
                    connection_id,
                )
                .await;
            }
            true
        }
        Err(error) => {
            send_app_error(outbound_tx, id, error);
            true
        }
    }
}

async fn handle_direct_message_send(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<DirectMessageSendPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message);
            return false;
        }
    };

    let target = match direct_target(payload.target_user_id, payload.target_username) {
        Ok(target) => target,
        Err(error) => {
            send_app_error(outbound_tx, id, error);
            return true;
        }
    };

    match messages_service::send_direct_message(
        &state.pool,
        current_user.clone(),
        target,
        payload.client_msg_id,
        payload.body,
    )
    .await
    {
        Ok(result) => {
            let newly_created = result.newly_created;
            send_ok(outbound_tx, id, "direct_message.send.ok", json!(result));
            if newly_created {
                fanout_message_created(
                    state,
                    result.conversation_id,
                    result.message,
                    connection_id,
                )
                .await;
            }
            true
        }
        Err(error) => {
            send_app_error(outbound_tx, id, error);
            true
        }
    }
}

async fn handle_conversation_read(
    state: &AppState,
    current_user: &CurrentUser,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<ConversationReadPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message);
            return false;
        }
    };

    match conversations_service::mark_read(
        &state.pool,
        current_user.user_id,
        payload.conversation_id,
        payload.read_seq,
    )
    .await
    {
        Ok(read_seq) => {
            send_ok(
                outbound_tx,
                id,
                "conversation.read.ok",
                json!({"conversation_id": payload.conversation_id, "read_seq": read_seq}),
            );
            true
        }
        Err(error) => {
            send_app_error(outbound_tx, id, error);
            true
        }
    }
}

fn handle_heartbeat_ping(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let _payload = match parse_payload::<HeartbeatPingPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message);
            return false;
        }
    };

    send_ok(
        outbound_tx,
        id,
        "heartbeat.pong",
        json!({"server_time": to_rfc3339_utc(now_utc())}),
    );
    true
}

async fn fanout_message_created(
    state: &AppState,
    conversation_id: Uuid,
    message: MessageDto,
    origin_connection_id: ConnectionId,
) {
    match conversations_service::visible_user_ids_for_message(
        &state.pool,
        conversation_id,
        message.message_seq,
    )
    .await
    {
        Ok(user_ids) => {
            state.registry.send_to_users(
                user_ids,
                ServerEnvelope::event(
                    "message.created",
                    json!({"conversation_id": conversation_id, "message": message}),
                ),
                Some(origin_connection_id),
            );
        }
        Err(error) => {
            tracing::warn!(
                code = error.code.as_str(),
                %conversation_id,
                "failed to resolve local websocket fanout recipients"
            );
        }
    }
}

fn parse_payload<T: DeserializeOwned>(envelope: &ClientEnvelope) -> Result<T, &'static str> {
    serde_json::from_value(envelope.payload.clone()).map_err(|_| "Invalid WebSocket payload")
}

fn direct_target(
    target_user_id: Option<Uuid>,
    target_username: Option<String>,
) -> AppResult<DirectTarget> {
    match (target_user_id, target_username) {
        (Some(user_id), None) => Ok(DirectTarget::UserId(user_id)),
        (None, Some(username)) if !username.trim().is_empty() => {
            Ok(DirectTarget::Username(username))
        }
        _ => Err(AppError::invalid_request(
            "exactly one of target_user_id or target_username is required",
        )),
    }
}

fn send_ok(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    id: Option<String>,
    message_type: &'static str,
    payload: serde_json::Value,
) {
    let _ = outbound_tx.try_send(ServerEnvelope::ok(id, message_type, payload));
}

fn send_app_error(outbound_tx: &mpsc::Sender<ServerEnvelope>, id: Option<String>, error: AppError) {
    let _ = outbound_tx.try_send(ServerEnvelope::error(id, error.code, error.message));
}

fn send_and_close(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    id: Option<String>,
    code: ErrorCode,
    message: impl Into<String>,
) {
    let _ = outbound_tx.try_send(ServerEnvelope::error(id, code, message));
}

async fn send_envelope_to_socket(socket: &mut WebSocket, envelope: ServerEnvelope) {
    if let Ok(text) = serde_json::to_string(&envelope) {
        let _ = socket.send(Message::Text(text.into())).await;
    }
}

fn too_many_connections_error() -> AppError {
    AppError::new(
        StatusCode::TOO_MANY_REQUESTS,
        ErrorCode::TooManyConnections,
        "Too many active WebSocket connections",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{config::Config, db, realtime::connection_registry::ConnectionRegistry};
    use serde_json::json;

    #[tokio::test]
    async fn text_message_for_removed_connection_closes_without_dispatching() {
        let state = test_state();
        let current_user = test_current_user();
        let (outbound_tx, mut outbound_rx) = mpsc::channel(1);
        let connection_id = Uuid::now_v7();

        let keep_processing = handle_incoming_message(
            Message::Text(
                json!({"id": "hb-1", "type": "heartbeat.ping", "payload": {}})
                    .to_string()
                    .into(),
            ),
            &state,
            &current_user,
            connection_id,
            &outbound_tx,
        )
        .await;

        assert!(!keep_processing);
        let envelope = outbound_rx
            .try_recv()
            .expect("removed connection should receive a close error envelope");
        assert_eq!(envelope.message_type, "error");
        assert_eq!(
            envelope.error.expect("error envelope").code,
            ErrorCode::HeartbeatTimeout.as_str()
        );
    }

    fn test_state() -> AppState {
        let config = Config {
            database_url: "postgres://nano:nano@localhost:5432/nano_chat_test".to_string(),
            jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
            bind_addr: "127.0.0.1:0".to_string(),
            rust_log: "nano_chat=debug".to_string(),
            notify_channel: "nano_chat_events".to_string(),
            max_connections_per_user: 10,
            heartbeat_interval_secs: 30,
            heartbeat_idle_timeout_secs: 90,
            max_ws_payload_bytes: 64 * 1024,
            max_message_bytes: 4096,
        };
        let pool = db::create_lazy_pool(&config.database_url).expect("create lazy pool");
        let registry = ConnectionRegistry::new(config.max_connections_per_user);
        AppState::with_registry(config, pool, registry)
    }

    fn test_current_user() -> CurrentUser {
        CurrentUser {
            user_id: Uuid::now_v7(),
            username: "alice".to_string(),
            display_name: Some("Alice".to_string()),
            client_id: Uuid::now_v7(),
        }
    }
}
