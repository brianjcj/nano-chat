use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::users::types::UserSummary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectTarget {
    Username(String),
    UserId(Uuid),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendMessageResult {
    pub conversation_id: Uuid,
    pub message: MessageDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageDto {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub message_seq: i64,
    pub sender: UserSummary,
    pub body: String,
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
