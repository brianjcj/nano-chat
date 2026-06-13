# Nano Chat Backend v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nano Chat v1 Rust backend described in `docs/superpowers/specs/2026-06-13-nano-chat-backend-design.md`.

**Architecture:** One Axum/Tokio service binary exposes REST and WebSocket APIs, stores durable chat state in Postgres through SQLx, and uses Postgres `LISTEN/NOTIFY` for cross-instance realtime fan-out. Domain logic is split into focused modules (`auth`, `users`, `conversations`, `messages`, `realtime`) with thin HTTP/WS handlers.

**Tech Stack:** Rust 2024, Axum, Tokio, SQLx/Postgres, Argon2id, JWT, UUID v7, Serde JSON, Tracing, Docker Compose.

---

## Global Implementation Rules

- Follow TDD: write the failing test, run it and confirm the expected failure, implement the minimal code, rerun and confirm pass.
- Use dynamic SQLx queries (`sqlx::query`, `query_as`) so normal compilation does not require a live database.
- Public JSON uses `snake_case`; timestamps are RFC3339 UTC strings.
- Keep `CONTEXT.md` a glossary only. Do not put implementation details there.
- Update `docs/api.md` when public HTTP/WS behavior is introduced or changed.
- Commit after each task with the commit message specified in that task.
- Do not introduce Redis, OpenAPI generation, media upload, friends, block lists, admin APIs, message edit/delete/recall, or public online status.

## Planned File Structure

Create or modify these files over the tasks:

```text
Cargo.toml
Dockerfile
docker-compose.yml
.env.example
migrations/0001_init.sql
src/main.rs
src/lib.rs
src/app.rs
src/config.rs
src/error.rs
src/ids.rs
src/time.rs
src/db.rs
src/auth/mod.rs
src/auth/http.rs
src/auth/service.rs
src/auth/types.rs
src/users/mod.rs
src/users/http.rs
src/users/service.rs
src/users/types.rs
src/conversations/mod.rs
src/conversations/http.rs
src/conversations/service.rs
src/conversations/types.rs
src/messages/mod.rs
src/messages/service.rs
src/messages/types.rs
src/realtime/mod.rs
src/realtime/connection_registry.rs
src/realtime/notify.rs
src/realtime/types.rs
src/ws/mod.rs
src/ws/protocol.rs
src/ws/handler.rs
tests/common/mod.rs
tests/auth_http.rs
tests/conversations_http.rs
tests/messages_service.rs
tests/ws_protocol.rs
tests/realtime_notify.rs
docs/api.md
```

Responsibilities:

- `src/app.rs`: compose `Router`, state, health/readiness routes.
- `src/config.rs`: environment parsing and default runtime settings.
- `src/error.rs`: shared `AppError`, HTTP/WS error payloads, stable error codes.
- `src/ids.rs`: UUID v7 helpers and typed ID aliases where useful.
- `src/time.rs`: UTC clock helpers and RFC3339 serialization helpers.
- `src/db.rs`: SQLx pool setup, migration helper for tests, repository shared helpers.
- `auth`: password hashing, JWT, register/login, authenticated user extraction, clients.
- `users`: exact username lookup and `display_name` update.
- `conversations`: direct/group conversation rules, membership, visibility spans, read positions, conversation list/member list HTTP.
- `messages`: idempotent message send, per-conversation sequence allocation, history queries.
- `realtime`: in-memory connection registry, local fan-out, Postgres notify bridge.
- `ws`: WebSocket envelope parsing, command dispatch, heartbeat, connection lifecycle.

## Test Commands

Use these commands throughout:

```bash
cargo fmt --all --check
cargo test --lib
cargo test --tests
cargo test
```

Database-backed tests may require Docker/Postgres. Use this when a task asks for full integration verification:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests
```

---

### Task 1: Rust Project Scaffold and Shared Primitives

**Files:**
- Create: `Cargo.toml`
- Create: `.env.example`
- Create: `src/main.rs`
- Create: `src/lib.rs`
- Create: `src/config.rs`
- Create: `src/error.rs`
- Create: `src/ids.rs`
- Create: `src/time.rs`
- Create: `src/app.rs`
- Create: `src/db.rs`
- Create: `tests/common/mod.rs`

- [ ] **Step 1: Write failing shared primitive tests**

Create `src/config.rs`, `src/error.rs`, `src/ids.rs`, and `src/time.rs` with module skeletons only if needed for the tests to compile far enough to fail on missing functions.

Add these unit tests in the same modules:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_accepts_lowercase_digits_and_underscore() {
        assert!(crate::users::types::validate_username("alice_123").is_ok());
    }

    #[test]
    fn username_rejects_uppercase_and_short_values() {
        assert!(crate::users::types::validate_username("Al").is_err());
        assert!(crate::users::types::validate_username("Alice").is_err());
    }
}
```

In `src/error.rs` add tests for stable JSON error payloads:

```rust
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
```

In `src/ids.rs` add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_id_returns_uuid_v7() {
        let id = new_uuid_v7();
        assert_eq!(id.get_version_num(), 7);
    }
}
```

In `src/time.rs` add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_utc_ends_with_z() {
        let value = to_rfc3339_utc(now_utc());
        assert!(value.ends_with('Z'));
        assert!(value.contains('T'));
    }
}
```

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
cargo test --lib
```

Expected: compilation fails because project modules/functions such as `validate_username`, `ErrorBody`, `new_uuid_v7`, or `to_rfc3339_utc` are not implemented.

- [ ] **Step 3: Implement scaffold and shared primitives**

Create `Cargo.toml` with these dependencies:

```toml
[package]
name = "nano-chat"
version = "0.1.0"
edition = "2024"

[dependencies]
anyhow = "1"
argon2 = "0.5"
async-trait = "0.1"
axum = { version = "0.8", features = ["ws", "macros"] }
chrono = { version = "0.4", features = ["serde"] }
dashmap = "6"
futures-util = "0.3"
jsonwebtoken = "9"
once_cell = "1"
password-hash = { version = "0.5", features = ["rand_core"] }
rand_core = { version = "0.6", features = ["std"] }
regex = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono", "json", "migrate"] }
thiserror = "2"
tokio = { version = "1", features = ["full"] }
tokio-stream = "0.1"
tower = "0.5"
tower-http = { version = "0.6", features = ["trace", "cors"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
uuid = { version = "1", features = ["v7", "serde"] }

[dev-dependencies]
http-body-util = "0.1"
tower = { version = "0.5", features = ["util"] }
```

Create `src/lib.rs` exporting modules:

```rust
pub mod app;
pub mod auth;
pub mod config;
pub mod conversations;
pub mod db;
pub mod error;
pub mod ids;
pub mod messages;
pub mod realtime;
pub mod time;
pub mod users;
pub mod ws;
```

Create minimal module skeletons for `auth`, `conversations`, `messages`, `realtime`, `users`, and `ws` so the crate compiles.

Implement:

- `Config::from_env()` reading `DATABASE_URL`, `JWT_SECRET`, `BIND_ADDR`, `RUST_LOG`, plus defaults for heartbeat and limits.
- `ErrorCode` enum with `as_str()` returning the codes from the spec.
- `ErrorBody::new(code, message)` producing `{ "error": { "code", "message" } }`.
- `new_uuid_v7() -> uuid::Uuid` using `Uuid::now_v7()`.
- `now_utc() -> chrono::DateTime<chrono::Utc>`.
- `to_rfc3339_utc()` using millisecond precision and trailing `Z`.
- `build_router(state)` with `GET /healthz` returning 200 and `GET /readyz` returning 200 for now.
- `main.rs` that loads config, initializes tracing, creates a Postgres pool with lazy connection, builds the router, and serves on `BIND_ADDR`.

- [ ] **Step 4: Run tests and formatting**

Run:

```bash
cargo fmt --all
cargo test --lib
cargo fmt --all --check
```

Expected: all library tests pass and formatting check passes.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml .env.example src tests
git commit -m "feat: scaffold Rust chat service"
```

---

### Task 2: Database Schema and SQLx Test Harness

**Files:**
- Create: `migrations/0001_init.sql`
- Modify: `src/db.rs`
- Create: `tests/common/mod.rs`
- Create: `tests/schema.rs`

- [ ] **Step 1: Write failing schema tests**

Create `tests/schema.rs`:

```rust
mod common;

use sqlx::Row;

#[tokio::test]
async fn migrations_create_core_tables() {
    let pool = common::test_pool().await;
    common::reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool).await.unwrap();

    let tables = sqlx::query(
        "select table_name from information_schema.tables where table_schema = 'public'",
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| row.get::<String, _>("table_name"))
    .collect::<std::collections::HashSet<_>>();

    for expected in [
        "users",
        "clients",
        "conversations",
        "direct_conversation_pairs",
        "conversation_members",
        "conversation_member_spans",
        "messages",
    ] {
        assert!(tables.contains(expected), "missing table {expected}");
    }
}
```

Create `tests/common/mod.rs` with explicit failure if `TEST_DATABASE_URL` or `DATABASE_URL` is absent:

```rust
use sqlx::{Executor, PgPool};

pub async fn test_pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set TEST_DATABASE_URL or DATABASE_URL for database tests");
    PgPool::connect(&url).await.expect("connect test database")
}

pub async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}
```

- [ ] **Step 2: Run schema test and verify expected failure**

Run with a Postgres test database:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test schema -- --nocapture
```

Expected: fails because `docker-compose.yml`, `run_migrations`, or migration tables do not exist yet.

- [ ] **Step 3: Implement migration and harness**

Create `docker-compose.yml` with one Postgres service:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: nano
      POSTGRES_PASSWORD: nano
      POSTGRES_DB: nano_chat_test
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nano -d nano_chat_test"]
      interval: 5s
      timeout: 3s
      retries: 20
```

Create `migrations/0001_init.sql` with tables from the design. Include constraints:

- `users.username unique`;
- `direct_conversation_pairs unique(user_low, user_high)`;
- `conversation_members primary key(conversation_id, user_id)`;
- `messages unique(conversation_id, message_seq)`;
- `messages unique(sender_user_id, client_id, client_msg_id)`;
- checks for conversation type/state, member state, positive message sequence, valid span ranges;
- indexes for active members, message pagination, and spans.

Implement `src/db.rs`:

```rust
use sqlx::{postgres::PgPoolOptions, PgPool};

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

pub async fn create_lazy_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect_lazy(database_url)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
```

- [ ] **Step 4: Run schema test and all library tests**

Run:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test schema -- --nocapture
cargo test --lib
```

Expected: schema test passes and library tests pass.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml migrations src/db.rs tests/common tests/schema.rs
git commit -m "feat: add postgres schema and migrations"
```

---

### Task 3: Auth, Users, Clients, and HTTP Middleware

**Files:**
- Create: `src/auth/mod.rs`
- Create: `src/auth/types.rs`
- Create: `src/auth/service.rs`
- Create: `src/auth/http.rs`
- Create: `src/users/mod.rs`
- Create: `src/users/types.rs`
- Create: `src/users/service.rs`
- Create: `src/users/http.rs`
- Modify: `src/app.rs`
- Modify: `src/error.rs`
- Create: `tests/auth_http.rs`

- [ ] **Step 1: Write failing auth/user tests**

Create `tests/auth_http.rs` with tests using Axum `oneshot` against the real router and test database:

```rust
mod common;

use axum::body::Body;
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn register_login_and_reuse_client_id() {
    let app = common::test_app().await;

    let register = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(json!({"username":"alice","password":"password123","display_name":"Alice"}).to_string()))
        .unwrap();
    let response = app.clone().oneshot(register).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::CREATED);

    let body: serde_json::Value = serde_json::from_slice(
        &response.into_body().collect().await.unwrap().to_bytes(),
    ).unwrap();
    let client_id = body["client_id"].as_str().unwrap().to_owned();
    assert!(body["access_token"].as_str().unwrap().len() > 20);

    let login = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(json!({"username":"alice","password":"password123","client_id":client_id}).to_string()))
        .unwrap();
    let response = app.oneshot(login).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
}

#[tokio::test]
async fn exact_username_lookup_requires_authentication() {
    let app = common::test_app().await;
    let request = axum::http::Request::builder()
        .uri("/api/v1/users?username=alice")
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
}
```

Update `tests/common/mod.rs` to expose `test_app()` that resets DB, runs migrations, creates `AppState`, and returns `Router`.

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test auth_http -- --nocapture
```

Expected: fails because auth routes, state, JWT, and user services are missing.

- [ ] **Step 3: Implement auth, users, clients, and middleware**

Implement request/response types:

```rust
#[derive(serde::Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub client_id: Option<uuid::Uuid>,
}

#[derive(serde::Serialize)]
pub struct AuthResponse {
    pub user: UserSummary,
    pub client_id: uuid::Uuid,
    pub access_token: String,
    pub expires_at: String,
}
```

Implement:

- Argon2id password hash/verify.
- JWT claims: `sub`, `client_id`, `exp`, `iat`.
- Register route: lowercases username, validates username/password/display_name, inserts user, creates client, returns 201.
- Login route: verifies password, reuses or creates client, validates client ownership, returns token.
- `GET /api/v1/me` authenticated.
- `PATCH /api/v1/me` updates `display_name`.
- `GET /api/v1/users?username=alice` exact lookup, authenticated.
- Auth extractor/middleware that reads `Authorization: Bearer <token>` and exposes current user/client.

- [ ] **Step 4: Run auth/user tests**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test auth_http -- --nocapture
cargo test --lib
```

Expected: auth HTTP tests and library tests pass.

- [ ] **Step 5: Update API docs**

Create/update `docs/api.md` sections for:

- auth endpoints;
- current user endpoints;
- exact user lookup;
- auth header format;
- auth error codes.

- [ ] **Step 6: Commit**

```bash
git add src/auth src/users src/app.rs src/error.rs tests/common tests/auth_http.rs docs/api.md
git commit -m "feat: add auth users and clients"
```

---

### Task 4: Conversations, Membership, Visibility Spans, and Read Positions

**Files:**
- Create: `src/conversations/mod.rs`
- Create: `src/conversations/types.rs`
- Create: `src/conversations/service.rs`
- Create: `src/conversations/http.rs`
- Modify: `src/app.rs`
- Modify: `src/error.rs`
- Create: `tests/conversations_http.rs`

- [ ] **Step 1: Write failing conversation tests**

Create `tests/conversations_http.rs` covering group lifecycle and list behavior:

```rust
mod common;

#[tokio::test]
async fn group_create_add_leave_rejoin_and_dissolve_follow_visibility_rules() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let group = ctx.create_group(&alice, "project", &[bob.user_id]).await;
    assert_eq!(group.name.as_deref(), Some("project"));

    ctx.add_member(&alice, group.conversation_id, carol.user_id).await;
    ctx.leave_group(&carol, group.conversation_id).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id).await;

    let members = ctx.group_members(&alice, group.conversation_id).await;
    assert!(members.iter().any(|m| m.user_id == alice.user_id));
    assert!(members.iter().any(|m| m.user_id == bob.user_id));
    assert!(members.iter().any(|m| m.user_id == carol.user_id));
}

#[tokio::test]
async fn group_creation_requires_creator_plus_one_member() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let response = ctx.create_group_raw(&alice, "solo", &[]).await;
    assert_eq!(response.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
}
```

Add helper methods to `tests/common/mod.rs` for authenticated requests.

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test conversations_http -- --nocapture
```

Expected: fails because conversation endpoints and service do not exist.

- [ ] **Step 3: Implement conversation services and HTTP**

Implement HTTP endpoints:

- `GET /api/v1/conversations`
- `POST /api/v1/conversations/groups`
- `GET /api/v1/conversations/{conversation_id}/members`
- `POST /api/v1/conversations/{conversation_id}/members`
- `DELETE /api/v1/conversations/{conversation_id}/members/me`

Implement service rules:

- Create group with creator + at least one other unique member.
- Enforce group name 1-80 chars.
- Enforce active member limit 500.
- Create `conversation_members` rows and open visibility spans.
- First-time group join span starts at seq 1.
- Rejoin span starts at `last_message_seq + 1`.
- Rejoin advances `read_seq` to current `last_message_seq`.
- Leave closes open span at current `last_message_seq`.
- Last active member leaving sets conversation state to `dissolved` and `dissolved_at`.
- Active members only can add members.
- Dissolved groups cannot be modified.
- Member list returns active members only.
- Conversation list includes active groups, including no-message groups, and excludes left/dissolved groups.

- [ ] **Step 4: Run conversation tests and existing tests**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test conversations_http -- --nocapture
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test auth_http -- --nocapture
cargo test --lib
```

Expected: conversation tests, auth tests, and library tests pass.

- [ ] **Step 5: Update API docs**

Document group endpoints, member rules, dissolved groups, conversation list summary, and relevant errors in `docs/api.md`.

- [ ] **Step 6: Commit**

```bash
git add src/conversations src/app.rs src/error.rs tests/common tests/conversations_http.rs docs/api.md
git commit -m "feat: add conversations and membership"
```

---

### Task 5: Message Sending, Idempotency, History, and Direct Conversation Creation

**Files:**
- Create: `src/messages/mod.rs`
- Create: `src/messages/types.rs`
- Create: `src/messages/service.rs`
- Modify: `src/conversations/service.rs`
- Modify: `src/error.rs`
- Create: `tests/messages_service.rs`

- [ ] **Step 1: Write failing message service tests**

Create `tests/messages_service.rs`:

```rust
mod common;

#[tokio::test]
async fn direct_message_creates_or_reuses_direct_conversation_atomically() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    let first = ctx
        .send_direct_message(&alice, "bob", "m1", "hello bob")
        .await;
    assert_eq!(first.message.message_seq, 1);

    let second = ctx
        .send_direct_message(&alice, "bob", "m2", "second")
        .await;
    assert_eq!(second.conversation_id, first.conversation_id);
    assert_eq!(second.message.message_seq, 2);
}

#[tokio::test]
async fn same_client_msg_id_with_different_body_is_conflict() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;

    ctx.send_direct_message(&alice, "bob", "same-key", "one").await;
    let response = ctx
        .send_direct_message_raw(&alice, "bob", "same-key", "two")
        .await;
    assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
}
```

The helper may call service functions directly before WS exists, or use a temporary test-only command wrapper. Prefer direct service calls from tests to avoid creating public HTTP send endpoints.

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test messages_service -- --nocapture
```

Expected: fails because message service does not exist.

- [ ] **Step 3: Implement message services**

Implement public service methods used later by WS:

```rust
pub async fn send_message(
    pool: &sqlx::PgPool,
    sender: CurrentUser,
    conversation_id: uuid::Uuid,
    client_msg_id: String,
    body: String,
) -> Result<SendMessageResult, AppError>;

pub async fn send_direct_message(
    pool: &sqlx::PgPool,
    sender: CurrentUser,
    target: DirectTarget,
    client_msg_id: String,
    body: String,
) -> Result<SendMessageResult, AppError>;

pub async fn list_messages(
    pool: &sqlx::PgPool,
    viewer: CurrentUser,
    conversation_id: uuid::Uuid,
    cursor: MessageCursor,
) -> Result<Vec<MessageDto>, AppError>;
```

Implement rules:

- Validate text body trim non-empty and max 4096 UTF-8 bytes.
- Validate `client_msg_id` length 1-100.
- Idempotency scope `(sender_user_id, client_id, client_msg_id)`.
- Same key + same fingerprint returns existing message.
- Same key + different fingerprint returns `idempotency_conflict`.
- Direct send finds target by username/user_id, creates or reuses direct conversation in the same transaction, inserts both members, and does not create empty direct conversations.
- Existing conversation send validates direct member or active group member.
- Dissolved group rejects sends.
- Lock conversation row with `SELECT ... FOR UPDATE` for sequence allocation.
- Insert message and update `conversations.last_message_seq`, `last_message_id`, `last_message_at`.
- Advance sender `read_seq` to message seq.
- History query filters by visibility spans and supports `after_seq`, `before_seq`, default 50, max 100.
- Message DTO includes current sender summary.

- [ ] **Step 4: Expose HTTP history endpoint only**

Add `GET /api/v1/conversations/{conversation_id}/messages` for history queries. Do not add HTTP send endpoints.

- [ ] **Step 5: Run message/conversation/auth tests**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test messages_service -- --nocapture
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test conversations_http -- --nocapture
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test auth_http -- --nocapture
cargo test --lib
```

Expected: all listed tests pass.

- [ ] **Step 6: Update API docs**

Document history endpoint, pagination, message DTO, send semantics reserved for WebSocket, idempotency behavior, and direct conversation creation semantics in `docs/api.md`.

- [ ] **Step 7: Commit**

```bash
git add src/messages src/conversations src/error.rs tests/messages_service.rs tests/common docs/api.md
git commit -m "feat: add message persistence and history"
```

---

### Task 6: WebSocket Protocol, Commands, Heartbeat, and Local Connection Registry

**Files:**
- Create: `src/ws/mod.rs`
- Create: `src/ws/protocol.rs`
- Create: `src/ws/handler.rs`
- Create: `src/realtime/mod.rs`
- Create: `src/realtime/connection_registry.rs`
- Create: `src/realtime/types.rs`
- Modify: `src/app.rs`
- Modify: `src/error.rs`
- Create: `tests/ws_protocol.rs`

- [ ] **Step 1: Write failing protocol and registry tests**

Create `tests/ws_protocol.rs`:

```rust
use nano_chat::ws::protocol::{ClientEnvelope, ServerEnvelope};
use serde_json::json;

#[test]
fn parses_message_send_envelope_with_snake_case_payload() {
    let raw = json!({
        "id": "req-1",
        "type": "message.send",
        "payload": {
            "conversation_id": "018f0000-0000-7000-8000-000000000001",
            "client_msg_id": "c1",
            "body": "hello"
        }
    });
    let parsed: ClientEnvelope = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.id.as_deref(), Some("req-1"));
    assert_eq!(parsed.message_type, "message.send");
}

#[test]
fn heartbeat_ping_may_omit_id() {
    let raw = json!({"type":"heartbeat.ping","payload":{"client_time":"2026-06-13T00:00:00Z"}});
    let parsed: ClientEnvelope = serde_json::from_value(raw).unwrap();
    assert!(parsed.id.is_none());
    assert_eq!(parsed.message_type, "heartbeat.ping");
}

#[test]
fn error_envelope_uses_stable_code() {
    let env = ServerEnvelope::error(Some("req-1".to_string()), nano_chat::error::ErrorCode::InvalidWsEnvelope, "Invalid envelope");
    let value = serde_json::to_value(env).unwrap();
    assert_eq!(value["type"], "error");
    assert_eq!(value["error"]["code"], "invalid_ws_envelope");
}
```

Add registry unit tests in `src/realtime/connection_registry.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_enforces_per_user_connection_limit() {
        let registry = ConnectionRegistry::new(2);
        let user_id = uuid::Uuid::now_v7();
        let client_id = uuid::Uuid::now_v7();
        assert!(registry.register_test_connection(user_id, client_id).is_ok());
        assert!(registry.register_test_connection(user_id, client_id).is_ok());
        assert!(registry.register_test_connection(user_id, client_id).is_err());
    }
}
```

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
cargo test --test ws_protocol -- --nocapture
cargo test --lib realtime::connection_registry -- --nocapture
```

Expected: fails because WS protocol and registry do not exist.

- [ ] **Step 3: Implement WS protocol and local registry**

Implement:

- `ClientEnvelope { id: Option<String>, message_type: String, payload: serde_json::Value }` using serde rename for JSON field `type`.
- `ServerEnvelope` constructors for `ok`, `event`, `error`.
- Command payload types for `message.send`, `direct_message.send`, `conversation.read`, `heartbeat.ping`.
- `ConnectionRegistry` storing instance-local connections keyed by `connection_id`, indexed by `user_id` and `conversation_id`/subscriptions as needed.
- Per-user connection limit 10 from config.
- `last_seen_at` updated on any valid incoming message.
- Idle cleanup function closing/removing connections older than 90 seconds.
- `/ws?version=1` route with token authentication.
- Unsupported WS version rejects connection.
- WS handler dispatches commands to existing services and sends `*.ok` responses.
- `heartbeat.ping` returns `heartbeat.pong` with `server_time`.
- Business errors return error envelopes without closing.
- Invalid envelope/oversized payload/auth/version/heartbeat timeout closes.
- Origin connection does not receive duplicate event for its own command.

- [ ] **Step 4: Run protocol and existing service tests**

Run:

```bash
cargo test --test ws_protocol -- --nocapture
cargo test --lib
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test messages_service -- --nocapture
```

Expected: protocol, registry, library, and message service tests pass.

- [ ] **Step 5: Update API docs**

Document:

- `/ws?version=1` authentication;
- envelope shapes;
- commands;
- success responses;
- error envelopes;
- heartbeat interval/timeout;
- origin echo behavior.

- [ ] **Step 6: Commit**

```bash
git add src/ws src/realtime src/app.rs src/error.rs tests/ws_protocol.rs docs/api.md
git commit -m "feat: add websocket protocol and registry"
```

---

### Task 7: Postgres Notify Bridge and Cross-instance Realtime Fan-out

**Files:**
- Create: `src/realtime/notify.rs`
- Modify: `src/realtime/types.rs`
- Modify: `src/messages/service.rs`
- Modify: `src/conversations/service.rs`
- Modify: `src/ws/handler.rs`
- Create: `tests/realtime_notify.rs`

- [ ] **Step 1: Write failing notify tests**

Create `tests/realtime_notify.rs`:

```rust
use nano_chat::realtime::types::{RealtimeEvent, RealtimeNotifyPayload};

#[test]
fn notify_payload_round_trips_complete_message_event_with_origin() {
    let payload = RealtimeNotifyPayload {
        origin_instance_id: "instance-a".to_string(),
        origin_connection_id: Some(uuid::Uuid::now_v7()),
        event: RealtimeEvent::MessageCreated {
            conversation_id: uuid::Uuid::now_v7(),
            message_id: uuid::Uuid::now_v7(),
            message_seq: 1,
            sender_user_id: uuid::Uuid::now_v7(),
            body: "hello".to_string(),
            created_at: "2026-06-13T00:00:00Z".to_string(),
        },
    };

    let encoded = payload.to_pg_notify_payload().unwrap();
    assert!(encoded.len() < 8_000);
    let decoded = RealtimeNotifyPayload::from_pg_notify_payload(&encoded).unwrap();
    assert_eq!(decoded.origin_instance_id, "instance-a");
}
```

Add a local fan-out unit test ensuring the origin connection is skipped while other same-user connections receive the event.

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
cargo test --test realtime_notify -- --nocapture
```

Expected: fails because notify payload types and fan-out helpers do not exist.

- [ ] **Step 3: Implement notify bridge**

Implement:

- `RealtimeEvent` enum for `message.created`, `conversation.read_updated`, `conversation.member_added`, `conversation.member_left`, `conversation.dissolved`, and `server.draining` if needed for shutdown.
- `RealtimeNotifyPayload` with `origin_instance_id`, optional `origin_connection_id`, and `event`.
- Serialization/deserialization to JSON string, rejecting payloads >= 8000 bytes.
- `NotifyPublisher` using `select pg_notify($1, $2)` after transactions commit.
- `NotifyListener` using a dedicated Postgres connection and `LISTEN nano_chat_events`.
- Listener loop that parses payload and calls local fan-out.
- Message service publishes complete `message.created` event after commit.
- Conversation service publishes member/read/dissolved events after commit.
- Local fan-out filters by event visibility and skips `origin_connection_id` on the origin instance.

- [ ] **Step 4: Add multi-instance integration test**

Add a test that creates two app states sharing one database, registers one local connection in each registry, publishes a notify event from instance A, and verifies instance B's local receiver gets the event. Use in-process registries instead of opening real network sockets if that keeps the test deterministic.

- [ ] **Step 5: Run realtime tests and service tests**

Run:

```bash
cargo test --test realtime_notify -- --nocapture
cargo test --test ws_protocol -- --nocapture
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test messages_service -- --nocapture
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test conversations_http -- --nocapture
```

Expected: realtime, WS protocol, message, and conversation tests pass.

- [ ] **Step 6: Update docs**

Update `docs/api.md` with realtime event payloads and sequence-gap recovery. Ensure it states that Postgres notify is best-effort and history sync is authoritative.

- [ ] **Step 7: Commit**

```bash
git add src/realtime src/messages src/conversations src/ws tests/realtime_notify.rs docs/api.md
git commit -m "feat: add postgres realtime fanout"
```

---

### Task 8: Operations, Docker Image, Final Docs, and End-to-end Verification

**Files:**
- Create: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `docs/api.md`
- Create: `tests/e2e_chat.rs`

- [ ] **Step 1: Write failing end-to-end test**

Create `tests/e2e_chat.rs`:

```rust
mod common;

#[tokio::test]
async fn end_to_end_direct_and_group_chat_core_flow() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;

    let direct = ctx.send_direct_message(&alice, "bob", "d1", "hello").await;
    assert_eq!(direct.message.message_seq, 1);

    let group = ctx.create_group(&alice, "team", &[bob.user_id]).await;
    ctx.add_member(&alice, group.conversation_id, carol.user_id).await;
    let group_msg = ctx.send_message(&bob, group.conversation_id, "g1", "hi team").await;
    assert_eq!(group_msg.message.message_seq, 1);

    ctx.mark_read(&alice, group.conversation_id, 1).await;
    let conversations = ctx.conversations(&alice).await;
    assert!(conversations.iter().any(|c| c.conversation_id == group.conversation_id));
}
```

- [ ] **Step 2: Run test and verify expected failure**

Run:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test e2e_chat -- --nocapture
```

Expected: fails until all helper paths and operations are wired correctly.

- [ ] **Step 3: Add Dockerfile and complete compose**

Create a multi-stage `Dockerfile`:

```dockerfile
FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/nano-chat /usr/local/bin/nano-chat
COPY migrations ./migrations
ENV BIND_ADDR=0.0.0.0:3000
EXPOSE 3000
CMD ["nano-chat"]
```

Update `docker-compose.yml` to include optional `app` service using environment variables from `.env.example` while keeping Postgres usable for tests.

Update `.env.example`:

```env
DATABASE_URL=postgres://nano:nano@postgres:5432/nano_chat_test
JWT_SECRET=change-me-development-secret-at-least-32-bytes
BIND_ADDR=0.0.0.0:3000
RUST_LOG=nano_chat=debug,tower_http=info
NANO_CHAT_NOTIFY_CHANNEL=nano_chat_events
NANO_CHAT_MAX_CONNECTIONS_PER_USER=10
NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS=90
```

- [ ] **Step 4: Complete docs/api.md**

Ensure `docs/api.md` contains complete sections for:

- auth;
- users/me;
- conversations;
- group members;
- message history;
- WebSocket envelope;
- commands;
- events;
- heartbeat;
- errors;
- sync/reconnect behavior;
- deployment/configuration notes.

- [ ] **Step 5: Run full verification**

Run:

```bash
cargo fmt --all --check
cargo test --lib
docker compose up -d postgres
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests -- --nocapture
cargo test
cargo build
```

Expected: formatting passes, all library tests pass, all integration tests pass with Postgres, normal tests pass, and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example docs/api.md tests/e2e_chat.rs
git commit -m "chore: add deployment docs and e2e coverage"
```

---

## Self-review Checklist

- Spec coverage: tasks cover project scaffold, schema, auth, users, clients, conversations, membership, visibility spans, messages, idempotency, sequence allocation, read positions, HTTP history, WebSocket protocol, heartbeat, local registry, Postgres notify fan-out, graceful-ish operations, Docker Compose, docs, and tests.
- Non-goals preserved: no Redis, no channels, no public online status, no HTTP send endpoint, no admin, no message edit/delete/recall, no media, no OpenAPI generation.
- Type consistency: `user_id`, `client_id`, `conversation_id`, `message_id`, `message_seq`, `client_msg_id`, `read_seq`, and `display_name` match the design document.
- Review requirement: each implementation task must be followed by spec compliance review and code quality review before moving to the next task.
