use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ids::UserId, users::types::UserSummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallMediaType {
    Audio,
    Video,
}

impl CallMediaType {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::Video => "video",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallState {
    Ringing,
    Connecting,
    Active,
    Ended,
}

impl CallState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Ringing => "ringing",
            Self::Connecting => "connecting",
            Self::Active => "active",
            Self::Ended => "ended",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallEndReason {
    Completed,
    Rejected,
    Canceled,
    Timeout,
    Busy,
    Offline,
    NetworkError,
}

impl CallEndReason {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Rejected => "rejected",
            Self::Canceled => "canceled",
            Self::Timeout => "timeout",
            Self::Busy => "busy",
            Self::Offline => "offline",
            Self::NetworkError => "network_error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallSummary {
    pub call_id: Uuid,
    pub conversation_id: Uuid,
    pub caller: UserSummary,
    pub callee: UserSummary,
    pub caller_client_id: Uuid,
    pub accepted_client_id: Option<Uuid>,
    pub media_type: CallMediaType,
    pub state: CallState,
    pub started_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub end_reason: Option<CallEndReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallCommandResult {
    pub call: CallSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallInviteOutcome {
    Started(CallCommandResult),
    Busy(CallCommandResult),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallSignalTarget {
    pub target_user_id: UserId,
    pub target_client_id: Uuid,
}
