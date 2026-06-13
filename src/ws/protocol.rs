use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::ErrorCode;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClientEnvelope {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerEnvelope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ServerError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerError {
    pub code: String,
    pub message: String,
}

impl ServerEnvelope {
    pub fn ok(id: Option<String>, message_type: impl Into<String>, payload: Value) -> Self {
        Self {
            id,
            message_type: message_type.into(),
            payload: Some(payload),
            error: None,
        }
    }

    pub fn event(message_type: impl Into<String>, payload: Value) -> Self {
        Self {
            id: None,
            message_type: message_type.into(),
            payload: Some(payload),
            error: None,
        }
    }

    pub fn error(id: Option<String>, code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            id,
            message_type: "error".to_string(),
            payload: None,
            error: Some(ServerError {
                code: code.as_str().to_string(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageSendPayload {
    pub conversation_id: Uuid,
    pub client_msg_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DirectMessageSendPayload {
    #[serde(default)]
    pub target_user_id: Option<Uuid>,
    #[serde(default)]
    pub target_username: Option<String>,
    pub client_msg_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConversationReadPayload {
    pub conversation_id: Uuid,
    pub read_seq: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HeartbeatPingPayload {
    #[serde(default)]
    pub client_time: Option<DateTime<Utc>>,
}
