use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ids::UserId, users::types::UserSummary};

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub client_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserSummary,
    pub client_id: Uuid,
    pub access_token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentUser {
    pub user_id: UserId,
    pub username: String,
    pub display_name: Option<String>,
    pub client_id: Uuid,
}

impl CurrentUser {
    pub fn summary(&self) -> UserSummary {
        UserSummary {
            user_id: self.user_id,
            username: self.username.clone(),
            display_name: self.display_name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Claims {
    pub sub: String,
    pub client_id: Uuid,
    pub exp: usize,
    pub iat: usize,
}
