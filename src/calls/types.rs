use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ids::UserId, messages::types::MessageDto, users::types::UserSummary};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_event_message: Option<MessageDto>,
}

impl CallCommandResult {
    pub(crate) fn without_call_event_message(call: CallSummary) -> Self {
        Self {
            call,
            call_event_message: None,
        }
    }

    pub(crate) fn with_call_event_message(call: CallSummary, message: MessageDto) -> Self {
        Self {
            call,
            call_event_message: Some(message),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallInviteOutcome {
    Started(CallCommandResult),
    Busy(CallCommandResult),
    Offline(CallCommandResult),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallSignalTarget {
    pub target_user_id: UserId,
    pub target_client_id: Uuid,
}
