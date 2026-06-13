use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::users::types::UserSummary;

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    #[serde(default)]
    pub member_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationSummary {
    pub conversation_id: Uuid,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub name: Option<String>,
    pub state: String,
    pub latest_message_seq: i64,
    pub read_seq: i64,
    pub unread_count: i64,
    pub active_member_count: i64,
    pub direct_user: Option<UserSummary>,
    pub latest_message: Option<LatestMessageSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LatestMessageSummary {
    pub message_id: Uuid,
    pub message_seq: i64,
    pub sender: UserSummary,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationMember {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
}
