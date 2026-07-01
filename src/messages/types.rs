use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ids::UserId, users::types::UserSummary};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectTarget {
    Username(String),
    UserId(UserId),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Text,
    CallEvent,
}

impl MessageKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::CallEvent => "call_event",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallEventMetadata {
    pub call_id: Uuid,
    pub media_type: String,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i64>,
    pub caller_user_id: UserId,
    pub callee_user_id: UserId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendMessageResult {
    pub conversation_id: Uuid,
    pub message: MessageDto,
    #[serde(skip)]
    pub(crate) newly_created: bool,
}

impl SendMessageResult {
    pub fn newly_created(&self) -> bool {
        self.newly_created
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageDto {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub message_seq: i64,
    pub sender: UserSummary,
    pub body: String,
    pub message_type: String,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageCursor {
    #[serde(default)]
    pub after_seq: Option<i64>,
    #[serde(default)]
    pub before_seq: Option<i64>,
    #[serde(default = "default_message_limit")]
    pub limit: i64,
}

impl Default for MessageCursor {
    fn default() -> Self {
        Self {
            after_seq: None,
            before_seq: None,
            limit: default_message_limit(),
        }
    }
}

fn default_message_limit() -> i64 {
    50
}
