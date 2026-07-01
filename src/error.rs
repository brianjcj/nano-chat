use axum::{
    Json,
    extract::rejection::{JsonRejection, PathRejection, QueryRejection},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidRequest,
    InvalidCredentials,
    UsernameTaken,
    InvalidToken,
    ClientNotFound,
    ClientOwnerMismatch,
    ConversationNotFound,
    MessageNotFound,
    NotConversationMember,
    NotActiveMember,
    ConversationDissolved,
    GroupMemberLimitExceeded,
    MessageTooLarge,
    EmptyMessage,
    IdempotencyConflict,
    TooManyConnections,
    UnsupportedWsVersion,
    InvalidWsEnvelope,
    WsPayloadTooLarge,
    HeartbeatTimeout,
    UserNotFound,
    CallBusy,
    CalleeOffline,
    CallNotFound,
    CallEnded,
    NotCallParticipant,
    Internal,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::InvalidCredentials => "invalid_credentials",
            Self::UsernameTaken => "username_taken",
            Self::InvalidToken => "invalid_token",
            Self::ClientNotFound => "client_not_found",
            Self::ClientOwnerMismatch => "client_owner_mismatch",
            Self::ConversationNotFound => "conversation_not_found",
            Self::MessageNotFound => "message_not_found",
            Self::NotConversationMember => "not_conversation_member",
            Self::NotActiveMember => "not_active_member",
            Self::ConversationDissolved => "conversation_dissolved",
            Self::GroupMemberLimitExceeded => "group_member_limit_exceeded",
            Self::MessageTooLarge => "message_too_large",
            Self::EmptyMessage => "empty_message",
            Self::IdempotencyConflict => "idempotency_conflict",
            Self::TooManyConnections => "too_many_connections",
            Self::UnsupportedWsVersion => "unsupported_ws_version",
            Self::InvalidWsEnvelope => "invalid_ws_envelope",
            Self::WsPayloadTooLarge => "ws_payload_too_large",
            Self::HeartbeatTimeout => "heartbeat_timeout",
            Self::UserNotFound => "user_not_found",
            Self::CallBusy => "call_busy",
            Self::CalleeOffline => "callee_offline",
            Self::CallNotFound => "call_not_found",
            Self::CallEnded => "call_ended",
            Self::NotCallParticipant => "not_call_participant",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            error: ErrorDetail {
                code: code.as_str().to_string(),
                message: message.into(),
            },
        }
    }
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub status: StatusCode,
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(status: StatusCode, code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, ErrorCode::InvalidRequest, message)
    }

    pub fn unprocessable_request(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::InvalidRequest,
            message,
        )
    }

    pub fn from_json_rejection(rejection: JsonRejection) -> Self {
        Self::invalid_request(match rejection {
            JsonRejection::MissingJsonContentType(_) => "Request body must be JSON",
            JsonRejection::JsonSyntaxError(_) => "Malformed JSON request body",
            JsonRejection::JsonDataError(_) => "Invalid JSON request body",
            JsonRejection::BytesRejection(_) => "Invalid request body",
            _ => "Invalid request",
        })
    }

    pub fn from_query_rejection(_rejection: QueryRejection) -> Self {
        Self::invalid_request("Invalid query parameters")
    }

    pub fn from_path_rejection(_rejection: PathRejection) -> Self {
        Self::invalid_request("Invalid path parameters")
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let status = self.status;
        let body = ErrorBody::new(self.code, self.message);
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_response_uses_stable_machine_code() {
        let body = ErrorBody::new(ErrorCode::InvalidToken, "Invalid token");
        assert_eq!(body.error.code, "invalid_token");
        assert_eq!(body.error.message, "Invalid token");
    }
}
