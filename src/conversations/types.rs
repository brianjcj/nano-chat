use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationMember {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
}
