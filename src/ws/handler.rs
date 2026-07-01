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

use crate::{
    app::AppState,
    auth::{service as auth_service, types::CurrentUser},
    calls::{
        service as calls_service,
        types::{CallEndReason, CallInviteOutcome},
    },
    conversations::service as conversations_service,
    error::{AppError, AppResult, ErrorCode},
    ids::UserId,
    messages::{service as messages_service, types::DirectTarget},
    realtime::{
        notify::fanout_notify_payload,
        types::{ConnectionId, RealtimeEvent, RealtimeNotifyPayload},
    },
    time::{now_utc, to_rfc3339_utc},
    ws::protocol::{
        CallHangupPayload, CallIdPayload, CallInvitePayload, CallSignalPayload, ClientEnvelope,
        ConversationReadPayload, DirectMessageSendPayload, HeartbeatPingPayload,
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
                    send_and_close(
                        &outbound_tx,
                        None,
                        ErrorCode::HeartbeatTimeout,
                        "WebSocket heartbeat timed out",
                    )
                    .await;
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
                return send_and_close(
                    outbound_tx,
                    None,
                    ErrorCode::WsPayloadTooLarge,
                    "WebSocket payload exceeds the maximum size",
                )
                .await;
            }

            let envelope = match serde_json::from_str::<ClientEnvelope>(text.as_str()) {
                Ok(envelope) => envelope,
                Err(_) => {
                    return send_and_close(
                        outbound_tx,
                        None,
                        ErrorCode::InvalidWsEnvelope,
                        "Invalid WebSocket envelope",
                    )
                    .await;
                }
            };

            if !state.registry.touch(connection_id) {
                return send_and_close(
                    outbound_tx,
                    None,
                    ErrorCode::HeartbeatTimeout,
                    "WebSocket heartbeat timed out",
                )
                .await;
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
            send_and_close(outbound_tx, None, code, message).await
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
            handle_conversation_read(state, current_user, connection_id, outbound_tx, envelope)
                .await
        }
        "call.invite" => {
            handle_call_invite(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.accept" => {
            handle_call_accept(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.connected" => {
            handle_call_connected(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.reject" => {
            handle_call_reject(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.cancel" => {
            handle_call_cancel(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.hangup" => {
            handle_call_hangup(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "call.signal" => {
            handle_call_signal(state, current_user, connection_id, outbound_tx, envelope).await
        }
        "heartbeat.ping" => handle_heartbeat_ping(outbound_tx, envelope).await,
        _ => {
            send_and_close(
                outbound_tx,
                envelope.id,
                ErrorCode::InvalidWsEnvelope,
                "Unsupported WebSocket command",
            )
            .await
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
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match messages_service::send_message_with_max_bytes(
        &state.pool,
        current_user.clone(),
        payload.conversation_id,
        payload.client_msg_id,
        payload.body,
        state.config.max_message_bytes,
    )
    .await
    {
        Ok(result) => {
            let newly_created = result.newly_created;
            if newly_created {
                publish_realtime_event(
                    state,
                    Some(connection_id),
                    RealtimeEvent::MessageCreated {
                        conversation_id: result.conversation_id,
                        message: result.message.clone(),
                    },
                )
                .await;
            }
            send_ok(outbound_tx, id, "message.send.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
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
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    let target = match direct_target(payload.target_user_id, payload.target_username) {
        Ok(target) => target,
        Err(error) => {
            return send_app_error(outbound_tx, id, error).await;
        }
    };

    match messages_service::send_direct_message_with_max_bytes(
        &state.pool,
        current_user.clone(),
        target,
        payload.client_msg_id,
        payload.body,
        state.config.max_message_bytes,
    )
    .await
    {
        Ok(result) => {
            let newly_created = result.newly_created;
            if newly_created {
                publish_realtime_event(
                    state,
                    Some(connection_id),
                    RealtimeEvent::MessageCreated {
                        conversation_id: result.conversation_id,
                        message: result.message.clone(),
                    },
                )
                .await;
            }
            send_ok(outbound_tx, id, "direct_message.send.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_conversation_read(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<ConversationReadPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match conversations_service::mark_read_with_status(
        &state.pool,
        current_user.user_id,
        payload.conversation_id,
        payload.read_seq,
    )
    .await
    {
        Ok(result) => {
            if result.changed {
                publish_realtime_event(
                    state,
                    Some(connection_id),
                    RealtimeEvent::ConversationReadUpdated {
                        conversation_id: payload.conversation_id,
                        user_id: current_user.user_id,
                        read_seq: result.read_seq,
                    },
                )
                .await;
            }
            send_ok(
                outbound_tx,
                id,
                "conversation.read.ok",
                json!({"conversation_id": payload.conversation_id, "read_seq": result.read_seq}),
            )
            .await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_invite(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallInvitePayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::invite_with_outcome(
        &state.pool,
        &state.registry,
        current_user.clone(),
        payload.conversation_id,
        payload.media_type,
    )
    .await
    {
        Ok(CallInviteOutcome::Started(result)) => {
            let keep_processing = send_ok(outbound_tx, id, "call.invite.ok", json!(result)).await;
            publish_realtime_event_to_local_users(
                state,
                Some(connection_id),
                RealtimeEvent::CallIncoming {
                    call: result.call.clone(),
                },
                [result.call.callee.user_id],
            )
            .await;
            publish_realtime_event_to_local_users(
                state,
                None,
                RealtimeEvent::CallRinging {
                    call: result.call.clone(),
                },
                [result.call.caller.user_id],
            )
            .await;
            keep_processing
        }
        Ok(CallInviteOutcome::Busy(result)) => {
            let keep_processing = send_app_error(
                outbound_tx,
                id,
                AppError::new(
                    StatusCode::CONFLICT,
                    ErrorCode::CallBusy,
                    "User is already in a call",
                ),
            )
            .await;
            publish_realtime_event_to_local_users(
                state,
                None,
                RealtimeEvent::CallBusy {
                    call: result.call.clone(),
                },
                [result.call.caller.user_id],
            )
            .await;
            keep_processing
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_accept(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallIdPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::accept(&state.pool, current_user.clone(), payload.call_id).await {
        Ok(result) => {
            publish_realtime_event(
                state,
                Some(connection_id),
                RealtimeEvent::CallAccepted {
                    call: result.call.clone(),
                },
            )
            .await;
            send_ok(outbound_tx, id, "call.accept.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_connected(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallIdPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::connected(&state.pool, current_user.clone(), payload.call_id).await {
        Ok(result) => {
            publish_realtime_event(
                state,
                Some(connection_id),
                RealtimeEvent::CallConnected {
                    call: result.call.clone(),
                },
            )
            .await;
            send_ok(outbound_tx, id, "call.connected.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_reject(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallIdPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::reject(&state.pool, current_user.clone(), payload.call_id).await {
        Ok(result) => {
            publish_realtime_event(
                state,
                Some(connection_id),
                RealtimeEvent::CallRejected {
                    call: result.call.clone(),
                },
            )
            .await;
            send_ok(outbound_tx, id, "call.reject.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_cancel(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallIdPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::cancel(&state.pool, current_user.clone(), payload.call_id).await {
        Ok(result) => {
            publish_realtime_event(
                state,
                Some(connection_id),
                RealtimeEvent::CallCanceled {
                    call: result.call.clone(),
                },
            )
            .await;
            send_ok(outbound_tx, id, "call.cancel.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_hangup(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallHangupPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };
    let reason = payload.reason.unwrap_or(CallEndReason::Completed);

    match calls_service::hangup(&state.pool, current_user.clone(), payload.call_id, reason).await {
        Ok(result) => {
            publish_realtime_event(
                state,
                Some(connection_id),
                RealtimeEvent::CallEnded {
                    call: result.call.clone(),
                },
            )
            .await;
            send_ok(outbound_tx, id, "call.hangup.ok", json!(result)).await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_call_signal(
    state: &AppState,
    current_user: &CurrentUser,
    connection_id: ConnectionId,
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let payload = match parse_payload::<CallSignalPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    match calls_service::signal_target(&state.pool, current_user, payload.call_id).await {
        Ok(target) => {
            let signal_type = payload.signal_type.clone();
            let signal_payload = json!({
                "call_id": payload.call_id,
                "signal_type": signal_type,
                "data": payload.data,
            });
            state.registry.send_to_client(
                target.target_user_id,
                target.target_client_id,
                ServerEnvelope::event("call.signal", signal_payload),
                Some(connection_id),
            );
            send_ok(
                outbound_tx,
                id,
                "call.signal.ok",
                json!({"call_id": payload.call_id}),
            )
            .await
        }
        Err(error) => send_app_error(outbound_tx, id, error).await,
    }
}

async fn handle_heartbeat_ping(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ClientEnvelope,
) -> bool {
    let id = envelope.id.clone();
    let _payload = match parse_payload::<HeartbeatPingPayload>(&envelope) {
        Ok(payload) => payload,
        Err(message) => {
            return send_and_close(outbound_tx, id, ErrorCode::InvalidWsEnvelope, message).await;
        }
    };

    send_ok(
        outbound_tx,
        id,
        "heartbeat.pong",
        json!({"server_time": to_rfc3339_utc(now_utc())}),
    )
    .await
}

async fn publish_realtime_event(
    state: &AppState,
    origin_connection_id: Option<ConnectionId>,
    event: RealtimeEvent,
) {
    let event_type = event.event_type();
    let payload = RealtimeNotifyPayload {
        origin_instance_id: state.instance_id.clone(),
        origin_connection_id,
        event,
    };

    if let Err(error) = fanout_notify_payload(&state.pool, &state.registry, &payload).await {
        tracing::warn!(%error, event_type, "failed to fan out websocket realtime event locally");
    }

    if let Err(error) = state.notify_publisher.publish(&payload).await {
        tracing::warn!(%error, event_type, "failed to publish websocket realtime notify event");
    }
}

async fn publish_realtime_event_to_local_users(
    state: &AppState,
    origin_connection_id: Option<ConnectionId>,
    event: RealtimeEvent,
    local_user_ids: impl IntoIterator<Item = UserId>,
) {
    let event_type = event.event_type();
    let payload = RealtimeNotifyPayload {
        origin_instance_id: state.instance_id.clone(),
        origin_connection_id,
        event,
    };

    state.registry.send_to_users(
        local_user_ids,
        payload.event.server_envelope(),
        payload.origin_connection_id,
    );

    if let Err(error) = state.notify_publisher.publish(&payload).await {
        tracing::warn!(%error, event_type, "failed to publish websocket realtime notify event");
    }
}

fn parse_payload<T: DeserializeOwned>(envelope: &ClientEnvelope) -> Result<T, &'static str> {
    serde_json::from_value(envelope.payload.clone()).map_err(|_| "Invalid WebSocket payload")
}

fn direct_target(
    target_user_id: Option<UserId>,
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

async fn send_ok(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    id: Option<String>,
    message_type: &'static str,
    payload: serde_json::Value,
) -> bool {
    enqueue_origin_envelope(outbound_tx, ServerEnvelope::ok(id, message_type, payload)).await
}

async fn send_app_error(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    id: Option<String>,
    error: AppError,
) -> bool {
    enqueue_origin_envelope(
        outbound_tx,
        ServerEnvelope::error(id, error.code, error.message),
    )
    .await
}

async fn send_and_close(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    id: Option<String>,
    code: ErrorCode,
    message: impl Into<String>,
) -> bool {
    let _ = enqueue_origin_envelope(outbound_tx, ServerEnvelope::error(id, code, message)).await;
    false
}

async fn enqueue_origin_envelope(
    outbound_tx: &mpsc::Sender<ServerEnvelope>,
    envelope: ServerEnvelope,
) -> bool {
    match outbound_tx.send(envelope).await {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(%error, "failed to enqueue websocket command response");
            false
        }
    }
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
    use futures_util::FutureExt;
    use serde_json::json;
    use uuid::Uuid;

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

    #[tokio::test]
    async fn ok_command_response_waits_for_full_origin_queue() {
        let (keep_processing, response) = run_command_with_full_origin_queue(json!({
            "id": "hb-1",
            "type": "heartbeat.ping",
            "payload": {}
        }))
        .await;

        assert!(keep_processing);
        assert_eq!(response.id.as_deref(), Some("hb-1"));
        assert_eq!(response.message_type, "heartbeat.pong");
    }

    #[tokio::test]
    async fn app_error_response_waits_for_full_origin_queue() {
        let (keep_processing, response) = run_command_with_full_origin_queue(json!({
            "id": "dm-1",
            "type": "direct_message.send",
            "payload": {
                "client_msg_id": "bad-target",
                "body": "hello"
            }
        }))
        .await;

        assert!(keep_processing);
        assert_eq!(response.id.as_deref(), Some("dm-1"));
        assert_eq!(response.message_type, "error");
        assert_eq!(
            response.error.expect("error envelope").code,
            ErrorCode::InvalidRequest.as_str()
        );
    }

    #[tokio::test]
    async fn direct_message_send_uses_configured_message_size_limit() {
        let mut state = test_state();
        state.config.max_message_bytes = 5;
        let current_user = test_current_user();
        let (outbound_tx, mut outbound_rx) = mpsc::channel(1);
        let registered = state
            .registry
            .register(
                current_user.user_id,
                current_user.client_id,
                outbound_tx.clone(),
            )
            .expect("register websocket connection");

        let keep_processing = handle_incoming_message(
            Message::Text(
                json!({
                    "id": "dm-too-large",
                    "type": "direct_message.send",
                    "payload": {
                        "target_username": "bob",
                        "client_msg_id": "too-large",
                        "body": "sixsix"
                    }
                })
                .to_string()
                .into(),
            ),
            &state,
            &current_user,
            registered.connection_id,
            &outbound_tx,
        )
        .await;

        assert!(keep_processing);
        let response = outbound_rx
            .recv()
            .await
            .expect("message size error envelope");
        assert_eq!(response.id.as_deref(), Some("dm-too-large"));
        assert_eq!(response.message_type, "error");
        assert_eq!(
            response.error.expect("error envelope").code,
            ErrorCode::MessageTooLarge.as_str()
        );
    }

    #[tokio::test]
    async fn close_error_response_waits_for_full_origin_queue() {
        let (keep_processing, response) = run_command_with_full_origin_queue(json!({
            "id": "bad-1",
            "type": "unsupported.command",
            "payload": {}
        }))
        .await;

        assert!(!keep_processing);
        assert_eq!(response.id.as_deref(), Some("bad-1"));
        assert_eq!(response.message_type, "error");
        assert_eq!(
            response.error.expect("error envelope").code,
            ErrorCode::InvalidWsEnvelope.as_str()
        );
    }

    async fn run_command_with_full_origin_queue(
        envelope: serde_json::Value,
    ) -> (bool, ServerEnvelope) {
        let state = test_state();
        let current_user = test_current_user();
        let (outbound_tx, mut outbound_rx) = mpsc::channel(1);
        let registered = state
            .registry
            .register(
                current_user.user_id,
                current_user.client_id,
                outbound_tx.clone(),
            )
            .expect("register websocket connection");
        outbound_tx
            .send(ServerEnvelope::event("preloaded", json!({})))
            .await
            .expect("preload full queue");

        let text = envelope.to_string();
        let mut command = Box::pin(handle_incoming_message(
            Message::Text(text.into()),
            &state,
            &current_user,
            registered.connection_id,
            &outbound_tx,
        ));

        assert!(
            command.as_mut().now_or_never().is_none(),
            "command response should wait for origin queue capacity"
        );

        let preloaded = outbound_rx.recv().await.expect("preloaded envelope");
        assert_eq!(preloaded.message_type, "preloaded");

        let keep_processing = command.await;
        let response = outbound_rx.recv().await.expect("command response envelope");

        (keep_processing, response)
    }

    fn test_state() -> AppState {
        let config = Config {
            database_url: "postgres://nano:nano@localhost:5432/nano_chat_test".to_string(),
            jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
            bind_addr: "127.0.0.1:0".to_string(),
            rust_log: "nano_chat=debug".to_string(),
            web_dist_dir: "web/dist".to_string(),
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
            user_id: UserId::new(1).unwrap(),
            username: "alice".to_string(),
            display_name: Some("Alice".to_string()),
            client_id: Uuid::now_v7(),
        }
    }
}
