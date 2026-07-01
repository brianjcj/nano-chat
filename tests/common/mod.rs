use axum::{
    Json, Router,
    body::Body,
    http::{
        Request, StatusCode,
        header::{AUTHORIZATION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use nano_chat::{
    app::{AppState, build_router},
    auth::types::CurrentUser,
    config::Config,
    conversations::service as conversations_service,
    ids::UserId,
    messages::{
        service as messages_service,
        types::{DirectTarget, SendMessageResult},
    },
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sqlx::{Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

const DEFAULT_TEST_DATABASE_URL: &str = "postgres://nano:nano@localhost:5432/nano_chat_test";

pub async fn test_pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| DEFAULT_TEST_DATABASE_URL.to_string());
    let url =
        validate_test_database_url(&url).expect("TEST_DATABASE_URL must point to a test database");
    PgPool::connect(&url).await.expect("connect test database")
}

pub fn validate_test_database_url(url: &str) -> Result<String, String> {
    let database_name = url
        .rsplit_once('/')
        .map(|(_, database)| database.split('?').next().unwrap_or(database))
        .filter(|database| !database.is_empty())
        .ok_or_else(|| "database URL must include a database name".to_string())?;

    if database_name.contains("test") {
        Ok(url.to_string())
    } else {
        Err(format!(
            "refusing to reset non-test database '{database_name}'; use TEST_DATABASE_URL with a database name containing 'test'"
        ))
    }
}

pub async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}

#[allow(dead_code)]
pub async fn test_app() -> Router {
    let pool = test_pool().await;
    reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool)
        .await
        .expect("run test migrations");
    build_router(AppState::new(test_config(), pool))
}

#[allow(dead_code)]
pub fn test_config() -> Config {
    Config {
        database_url: std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://nano:nano@localhost:5432/nano_chat_test".to_string()),
        jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
        bind_addr: "127.0.0.1:0".to_string(),
        rust_log: "nano_chat=debug".to_string(),
        web_dist_dir: "web/dist".to_string(),
        notify_channel: "nano_chat_events".to_string(),
        max_connections_per_user: 10,
        heartbeat_interval_secs: 30,
        heartbeat_idle_timeout_secs: 90,
        max_ws_payload_bytes: 64 * 1024,
        max_message_bytes: 4096,
        call_ringing_timeout_secs: 60,
        call_disconnect_grace_secs: 15,
        call_cleanup_interval_secs: 5,
        turn_public_host: "turn.example.com".to_string(),
        turn_realm: "turn.example.com".to_string(),
        turn_shared_secret: "change-me-turn-shared-secret-at-least-32-bytes".to_string(),
        turn_credential_ttl_secs: 600,
        turn_udp_url: "turn:turn.example.com:3478?transport=udp".to_string(),
        turn_tcp_url: "turn:turn.example.com:3478?transport=tcp".to_string(),
        stun_url: "stun:turn.example.com:3478".to_string(),
    }
}

#[allow(dead_code)]
pub struct TestContext {
    pub app: Router,
    pub pool: PgPool,
    pub state: AppState,
}

#[allow(dead_code)]
impl TestContext {
    pub async fn new() -> Self {
        let pool = test_pool().await;
        reset_database(&pool).await;
        nano_chat::db::run_migrations(&pool)
            .await
            .expect("run test migrations");
        let state = AppState::new(test_config(), pool.clone());
        let app = build_router(state.clone());
        Self { app, pool, state }
    }

    pub fn register_ws_sender_for(&self, user: &TestUser) -> uuid::Uuid {
        let (sender, _receiver) = tokio::sync::mpsc::channel(8);
        let registered = self
            .state
            .registry
            .register(user.user_id, user.client_id, sender)
            .expect("test websocket sender registers");
        registered.connection_id
    }

    pub async fn register(&self, username: &str) -> TestUser {
        let display_name = title_case(username);
        let request = json_request(
            "POST",
            "/api/v1/auth/register",
            json!({"username": username, "password": "password123", "display_name": display_name}),
        );
        let response = self.app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let body: AuthResponse = response_json_as(response).await;
        TestUser {
            user_id: body.user.user_id,
            username: body.user.username,
            display_name: body.user.display_name,
            client_id: body.client_id,
            access_token: body.access_token,
        }
    }

    pub async fn login_existing_client(&self, username: &str, client_id: Option<Uuid>) -> TestUser {
        let response = self
            .app
            .clone()
            .oneshot(json_request(
                "POST",
                "/api/v1/auth/login",
                json!({"username": username, "password": "password123", "client_id": client_id}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: AuthResponse = response_json_as(response).await;
        TestUser {
            user_id: body.user.user_id,
            username: body.user.username,
            display_name: body.user.display_name,
            client_id: body.client_id,
            access_token: body.access_token,
        }
    }

    pub async fn conversations(&self, user: &TestUser) -> Vec<TestConversation> {
        let request = authed_empty_request("GET", "/api/v1/conversations", user);
        let response = self.app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response_json_as(response).await
    }

    pub async fn create_group(
        &self,
        user: &TestUser,
        name: &str,
        member_ids: &[UserId],
    ) -> TestConversation {
        let response = self.create_group_raw(user, name, member_ids).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        response_json_as(response).await
    }

    pub async fn create_group_raw(
        &self,
        user: &TestUser,
        name: &str,
        member_ids: &[UserId],
    ) -> Response {
        let request = authed_json_request(
            "POST",
            "/api/v1/conversations/groups",
            user,
            json!({"name": name, "member_ids": member_ids}),
        );
        self.app.clone().oneshot(request).await.unwrap()
    }

    pub async fn group_members(&self, user: &TestUser, conversation_id: Uuid) -> Vec<TestMember> {
        let request = authed_empty_request(
            "GET",
            &format!("/api/v1/conversations/{conversation_id}/members"),
            user,
        );
        let response = self.app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response_json_as(response).await
    }

    pub async fn add_member(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        member_id: UserId,
    ) -> TestMember {
        let response = self.add_member_raw(user, conversation_id, member_id).await;
        assert_eq!(response.status(), StatusCode::OK);
        response_json_as(response).await
    }

    pub async fn add_member_raw(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        member_id: UserId,
    ) -> Response {
        let request = authed_json_request(
            "POST",
            &format!("/api/v1/conversations/{conversation_id}/members"),
            user,
            json!({"user_id": member_id}),
        );
        self.app.clone().oneshot(request).await.unwrap()
    }

    pub async fn leave_group(&self, user: &TestUser, conversation_id: Uuid) {
        let response = self.leave_group_raw(user, conversation_id).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    pub async fn leave_group_raw(&self, user: &TestUser, conversation_id: Uuid) -> Response {
        let request = authed_empty_request(
            "DELETE",
            &format!("/api/v1/conversations/{conversation_id}/members/me"),
            user,
        );
        self.app.clone().oneshot(request).await.unwrap()
    }

    pub async fn send_direct_message(
        &self,
        user: &TestUser,
        target_username: &str,
        client_msg_id: &str,
        body: &str,
    ) -> SendMessageResult {
        messages_service::send_direct_message(
            &self.pool,
            user.current_user(),
            DirectTarget::Username(target_username.to_string()),
            client_msg_id.to_string(),
            body.to_string(),
        )
        .await
        .expect("direct message should send")
    }

    pub async fn send_direct_message_raw(
        &self,
        user: &TestUser,
        target_username: &str,
        client_msg_id: &str,
        body: &str,
    ) -> Response {
        match messages_service::send_direct_message(
            &self.pool,
            user.current_user(),
            DirectTarget::Username(target_username.to_string()),
            client_msg_id.to_string(),
            body.to_string(),
        )
        .await
        {
            Ok(result) => (StatusCode::OK, Json(result)).into_response(),
            Err(error) => error.into_response(),
        }
    }

    pub async fn send_message(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        client_msg_id: &str,
        body: &str,
    ) -> SendMessageResult {
        messages_service::send_message(
            &self.pool,
            user.current_user(),
            conversation_id,
            client_msg_id.to_string(),
            body.to_string(),
        )
        .await
        .expect("message should send")
    }

    pub async fn send_message_raw(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        client_msg_id: &str,
        body: &str,
    ) -> Response {
        match messages_service::send_message(
            &self.pool,
            user.current_user(),
            conversation_id,
            client_msg_id.to_string(),
            body.to_string(),
        )
        .await
        {
            Ok(result) => (StatusCode::OK, Json(result)).into_response(),
            Err(error) => error.into_response(),
        }
    }

    pub async fn mark_read(&self, user: &TestUser, conversation_id: Uuid, read_seq: i64) -> i64 {
        conversations_service::mark_read(&self.pool, user.user_id, conversation_id, read_seq)
            .await
            .expect("conversation read position should update")
    }

    pub async fn messages(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        query: &str,
    ) -> Vec<TestMessage> {
        let response = self.messages_raw(user, conversation_id, query).await;
        assert_eq!(response.status(), StatusCode::OK);
        response_json_as(response).await
    }

    pub async fn messages_raw(
        &self,
        user: &TestUser,
        conversation_id: Uuid,
        query: &str,
    ) -> Response {
        let suffix = if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        };
        let request = authed_empty_request(
            "GET",
            &format!("/api/v1/conversations/{conversation_id}/messages{suffix}"),
            user,
        );
        self.app.clone().oneshot(request).await.unwrap()
    }

    pub async fn update_display_name(&self, user: &TestUser, display_name: Option<&str>) {
        let request = authed_json_request(
            "PATCH",
            "/api/v1/me",
            user,
            json!({"display_name": display_name}),
        );
        let response = self.app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TestUser {
    pub user_id: UserId,
    pub username: String,
    pub display_name: Option<String>,
    pub client_id: Uuid,
    pub access_token: String,
}

#[allow(dead_code)]
impl TestUser {
    pub fn current_user(&self) -> CurrentUser {
        CurrentUser {
            user_id: self.user_id,
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            client_id: self.client_id,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TestConversation {
    pub conversation_id: Uuid,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub name: Option<String>,
    pub state: String,
    pub latest_message_seq: i64,
    pub read_seq: i64,
    pub unread_count: i64,
    pub active_member_count: i64,
    pub direct_user: Option<TestMember>,
    pub latest_message: Option<TestLatestMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TestMember {
    pub user_id: UserId,
    pub username: String,
    pub display_name: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TestLatestMessage {
    pub message_id: Uuid,
    pub message_seq: i64,
    pub sender: TestMember,
    pub body: String,
    pub message_type: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TestMessage {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub message_seq: i64,
    pub sender: TestMember,
    pub body: String,
    pub message_type: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct AuthResponse {
    user: AuthUser,
    client_id: Uuid,
    access_token: String,
    #[allow(dead_code)]
    expires_at: String,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    user_id: UserId,
    username: String,
    display_name: Option<String>,
}

#[allow(dead_code)]
pub fn json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[allow(dead_code)]
pub fn authed_json_request(method: &str, uri: &str, user: &TestUser, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, bearer(user))
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[allow(dead_code)]
pub fn authed_empty_request(method: &str, uri: &str, user: &TestUser) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, bearer(user))
        .body(Body::empty())
        .unwrap()
}

#[allow(dead_code)]
pub fn bearer(user: &TestUser) -> String {
    format!("Bearer {}", user.access_token)
}

#[allow(dead_code)]
pub async fn response_json(response: Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "response body should be JSON: {error}; body={}",
            String::from_utf8_lossy(&bytes)
        )
    })
}

#[allow(dead_code)]
pub async fn response_json_as<T>(response: Response) -> T
where
    T: DeserializeOwned,
{
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "response body should match expected JSON shape: {error}; body={}",
            String::from_utf8_lossy(&bytes)
        )
    })
}

fn title_case(username: &str) -> String {
    let mut chars = username.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => username.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_test_database_url;

    #[test]
    fn accepts_database_url_with_test_database_name() {
        let url = "postgres://nano:nano@localhost:5432/nano_chat_test";
        assert_eq!(validate_test_database_url(url).unwrap(), url);
    }

    #[test]
    fn rejects_database_url_without_test_database_name() {
        let error = validate_test_database_url("postgres://nano:nano@localhost:5432/nano_chat")
            .expect_err("non-test database should be rejected");
        assert!(error.contains("refusing to reset non-test database"));
    }
}
