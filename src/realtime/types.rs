use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    conversations::types::ConversationMember, messages::types::MessageDto,
    ws::protocol::ServerEnvelope,
};

pub const PG_NOTIFY_PAYLOAD_LIMIT_BYTES: usize = 8_000;

pub type ConnectionId = Uuid;
pub type ConnectionSender = mpsc::Sender<ServerEnvelope>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredConnection {
    pub connection_id: ConnectionId,
    pub user_id: Uuid,
    pub client_id: Uuid,
    pub connected_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RealtimeEvent {
    #[serde(rename = "message.created")]
    MessageCreated {
        conversation_id: Uuid,
        message: MessageDto,
    },
    #[serde(rename = "conversation.read_updated")]
    ConversationReadUpdated {
        conversation_id: Uuid,
        user_id: Uuid,
        read_seq: i64,
    },
    #[serde(rename = "conversation.member_added")]
    ConversationMemberAdded {
        conversation_id: Uuid,
        member: ConversationMember,
    },
    #[serde(rename = "conversation.member_left")]
    ConversationMemberLeft {
        conversation_id: Uuid,
        user_id: Uuid,
    },
    #[serde(rename = "conversation.dissolved")]
    ConversationDissolved {
        conversation_id: Uuid,
        user_id: Uuid,
    },
    #[serde(rename = "server.draining")]
    ServerDraining,
}

impl RealtimeEvent {
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::MessageCreated { .. } => "message.created",
            Self::ConversationReadUpdated { .. } => "conversation.read_updated",
            Self::ConversationMemberAdded { .. } => "conversation.member_added",
            Self::ConversationMemberLeft { .. } => "conversation.member_left",
            Self::ConversationDissolved { .. } => "conversation.dissolved",
            Self::ServerDraining => "server.draining",
        }
    }

    pub fn websocket_payload(&self) -> serde_json::Value {
        match self {
            Self::MessageCreated {
                conversation_id,
                message,
            } => serde_json::json!({
                "conversation_id": conversation_id,
                "message": message,
            }),
            Self::ConversationReadUpdated {
                conversation_id,
                user_id,
                read_seq,
            } => serde_json::json!({
                "conversation_id": conversation_id,
                "user_id": user_id,
                "read_seq": read_seq,
            }),
            Self::ConversationMemberAdded {
                conversation_id,
                member,
            } => serde_json::json!({
                "conversation_id": conversation_id,
                "member": member,
            }),
            Self::ConversationMemberLeft {
                conversation_id,
                user_id,
            } => serde_json::json!({
                "conversation_id": conversation_id,
                "user_id": user_id,
            }),
            Self::ConversationDissolved {
                conversation_id,
                user_id,
            } => serde_json::json!({
                "conversation_id": conversation_id,
                "user_id": user_id,
            }),
            Self::ServerDraining => serde_json::json!({}),
        }
    }

    pub fn server_envelope(&self) -> ServerEnvelope {
        ServerEnvelope::event(self.event_type(), self.websocket_payload())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RealtimeNotifyPayload {
    pub origin_instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_connection_id: Option<ConnectionId>,
    pub event: RealtimeEvent,
}

impl RealtimeNotifyPayload {
    pub fn to_pg_notify_payload(&self) -> Result<String, RealtimeNotifyPayloadError> {
        let encoded = serde_json::to_string(self)?;
        if encoded.len() >= PG_NOTIFY_PAYLOAD_LIMIT_BYTES {
            return Err(RealtimeNotifyPayloadError::PayloadTooLarge {
                len: encoded.len(),
                limit: PG_NOTIFY_PAYLOAD_LIMIT_BYTES,
            });
        }
        Ok(encoded)
    }

    pub fn from_pg_notify_payload(raw: &str) -> Result<Self, RealtimeNotifyPayloadError> {
        if raw.len() >= PG_NOTIFY_PAYLOAD_LIMIT_BYTES {
            return Err(RealtimeNotifyPayloadError::PayloadTooLarge {
                len: raw.len(),
                limit: PG_NOTIFY_PAYLOAD_LIMIT_BYTES,
            });
        }
        Ok(serde_json::from_str(raw)?)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RealtimeNotifyPayloadError {
    #[error("Postgres NOTIFY payload is {len} bytes, exceeding the {limit}-byte limit")]
    PayloadTooLarge { len: usize, limit: usize },
    #[error("invalid realtime notify JSON payload: {0}")]
    Json(#[from] serde_json::Error),
}
