# 1v1 WebRTC Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-oriented 1v1 audio/video WebRTC calls that start from an existing direct conversation.

**Architecture:** The Rust backend owns durable call sessions, user-global busy locking, authorization, timeouts, call record messages, and WebSocket signaling envelopes. Browser media stays peer-to-peer through WebRTC, with coturn TURN relay for public-network reliability. Frontend call behavior is isolated behind a `CallProvider` and `CallEngine` so chat UI only renders buttons and call-event messages.

**Tech Stack:** Rust 2024, Axum, Tokio, SQLx/Postgres, Postgres LISTEN/NOTIFY, HMAC-SHA1 TURN REST credentials, React, TypeScript, Vite, Zustand-style local state, existing RealtimeClient, WebRTC browser APIs, Vitest/React Testing Library, Docker Compose, Caddy, coturn.

## Global Constraints

- Calls start only from existing active direct conversations.
- Media types are exactly `audio` and `video`.
- Call states are exactly `ringing`, `connecting`, `active`, and `ended`.
- End reasons are exactly `completed`, `rejected`, `canceled`, `timeout`, `busy`, `offline`, and `network_error`.
- A user can participate in only one non-ended call globally across all clients.
- All online callee clients ring; the first accepted client wins and the other clients stop ringing.
- WebRTC offer/answer/ICE signaling is transient and is not written to message history.
- Server-side media inspection, transcoding, storage, recording, SFU integration, group calls, and screen sharing are out of scope.
- Public JSON remains `snake_case`; frontend TypeScript DTOs mirror that shape.
- Production browser calls require HTTPS/WSS through Caddy.
- TURN credentials use coturn shared-secret authentication and are short-lived; static TURN credentials must not be embedded in frontend code.
- Use TDD for behavior changes and commit after each task.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-07-01-1v1-webrtc-calls-design.md`
- Glossary: `CONTEXT.md`
- Backend API docs: `docs/api.md`
- Existing backend plan for conventions: `docs/superpowers/plans/2026-06-13-nano-chat-backend-v1.md`
- Existing web plan for frontend conventions: `docs/superpowers/plans/2026-06-14-nano-chat-web-v1.md`

## Planned File Structure

### Backend files

- `migrations/0002_calls.sql` — call tables, busy-lock index, `messages.message_type`, `messages.metadata`.
- `Cargo.toml` — add `base64`, `hmac`, and `sha1` for TURN credentials.
- `.env.example` — call timeout and TURN/Caddy/coturn variables.
- `src/lib.rs` — export `calls`.
- `src/config.rs` — parse call timeout, disconnect grace, TURN realm/host/secret/TTL/URLs.
- `src/error.rs` — add stable call error codes.
- `src/app.rs` — merge calls HTTP router and make lifecycle tasks available.
- `src/main.rs` — run startup cleanup and background call timeout cleanup.
- `src/calls/mod.rs` — module exports.
- `src/calls/types.rs` — enums and DTOs for call lifecycle and ICE config.
- `src/calls/service.rs` — deep call lifecycle module: invite, accept, connected, reject, cancel, hangup, timeout, startup cleanup, call record insertion, signal authorization.
- `src/calls/http.rs` — authenticated `GET /api/v1/calls/ice-servers`.
- `src/calls/ice.rs` — coturn shared-secret credential generation.
- `src/messages/types.rs` — add message type and metadata to message DTOs.
- `src/messages/service.rs` — support inserting `call_event` messages in a locked conversation.
- `src/conversations/types.rs` — latest-message DTO includes message type and metadata.
- `src/conversations/service.rs` — query message type and metadata in conversation summaries.
- `src/realtime/connection_registry.rs` — online checks and user+client targeted delivery.
- `src/realtime/types.rs` — call state event variants; signal is represented as a server envelope but not published through Postgres NOTIFY.
- `src/realtime/notify.rs` — fan out call state events to the two call users.
- `src/ws/protocol.rs` — call command payload structs.
- `src/ws/handler.rs` — dispatch call commands and target `call.signal` locally.
- `docs/api.md` — document call HTTP and WebSocket protocol.
- `docker-compose.yml` — add Caddy/coturn services and app network changes.
- `Caddyfile` — HTTPS reverse proxy to app.
- `coturn/turnserver.conf` — coturn settings for shared-secret auth and relay port range.
- `tests/calls_service.rs` — service-level call lifecycle tests.
- `tests/calls_http.rs` — ICE endpoint tests.
- `tests/calls_ws_e2e.rs` — WebSocket call flow tests.
- `tests/schema.rs` — migration/schema assertions for call tables and message columns.
- `tests/deployment_config.rs` — static checks for compose/Caddy/coturn config.

### Frontend files

- `web/src/shared/api/types.ts` — call event message metadata and ICE server DTOs.
- `web/src/shared/api/client.ts` — `getIceServers()`.
- `web/src/shared/api/client.test.ts` — API client coverage for ICE endpoint.
- `web/src/shared/realtime/protocol.ts` — call command/event envelope types.
- `web/src/shared/realtime/protocol.type-test.ts` — compile-time call protocol assertions.
- `web/src/shared/realtime/realtimeClient.test.ts` — call command response behavior.
- `web/src/shared/utils/message.ts` — message union supports text and call events.
- `web/src/features/im/components/MessageList.tsx` — render `call_event` messages.
- `web/src/features/im/components/MessageList.test.tsx` — outcome rendering tests.
- `web/src/features/im/components/ChatView.tsx` — render call buttons for active direct conversations.
- `web/src/features/calls/CallEngine.ts` — WebRTC/media module with injected browser dependencies.
- `web/src/features/calls/CallEngine.test.ts` — fake WebRTC/media tests.
- `web/src/features/calls/CallProvider.tsx` — global call state and command interface.
- `web/src/features/calls/CallProvider.test.tsx` — invite/incoming/accept/reject/hangup tests.
- `web/src/features/calls/components/ChatHeaderCallButtons.tsx` — audio/video buttons.
- `web/src/features/calls/components/IncomingCallDialog.tsx` — global incoming-call prompt and ringtone.
- `web/src/features/calls/components/CallOverlay.tsx` — in-call controls and streams.
- `web/src/features/calls/components/*.test.tsx` — focused UI tests.
- `web/src/features/shell/AuthenticatedAppLayout.tsx` — mount call provider, dialog, and overlay inside realtime context.
- `web/src/shared/i18n/resources.ts` — call UI and call record strings.

## Test Commands

Backend unit and integration:

```bash
cargo fmt --all --check
cargo test --lib
docker compose up -d postgres
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests
```

Frontend:

```bash
cd web && pnpm lint
cd web && pnpm typecheck
cd web && pnpm test
cd web && pnpm build
```

---

### Task 1: Database Migration and Message DTO Support for Call Records

**Files:**
- Create: `migrations/0002_calls.sql`
- Modify: `src/messages/types.rs`
- Modify: `src/messages/service.rs`
- Modify: `src/conversations/types.rs`
- Modify: `src/conversations/service.rs`
- Modify: `tests/common/mod.rs`
- Modify: `tests/schema.rs`
- Modify: `tests/messages_service.rs`
- Modify: `docs/api.md`

**Interfaces:**
- Produces: `MessageKind`, `CallEventMetadata`, `MessageDto.message_type`, `MessageDto.metadata`.
- Produces: `messages::service::insert_call_event_message_in_locked_conversation(tx, conversation_id, actor, body, metadata) -> AppResult<SendMessageResult>` for later call service tasks.

- [ ] **Step 1: Write failing schema tests**

Add these assertions to `tests/schema.rs`:

```rust
#[tokio::test]
#[serial_test::serial]
async fn calls_schema_and_call_event_message_columns_exist() {
    let ctx = common::TestContext::new().await;

    let call_sessions_exists: bool = sqlx::query_scalar(
        "select exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'call_sessions'
        )",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(call_sessions_exists);

    let call_participants_exists: bool = sqlx::query_scalar(
        "select exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'call_participants'
        )",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(call_participants_exists);

    let message_type_default: String = sqlx::query_scalar(
        "select column_default
         from information_schema.columns
         where table_name = 'messages' and column_name = 'message_type'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(message_type_default.contains("'text'"));

    let metadata_type: String = sqlx::query_scalar(
        "select data_type
         from information_schema.columns
         where table_name = 'messages' and column_name = 'metadata'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(metadata_type, "jsonb");
}
```

- [ ] **Step 2: Write failing message DTO tests**

In `tests/messages_service.rs`, add:

```rust
#[tokio::test]
#[serial_test::serial]
async fn text_messages_return_type_and_empty_metadata() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let _bob = ctx.register("bob").await;

    let sent = ctx
        .send_direct_message(&alice, "bob", "typed-text", "hello")
        .await;
    assert_eq!(sent.message.message_type, "text");
    assert_eq!(sent.message.metadata, serde_json::json!({}));

    let history = ctx.messages(&alice, sent.conversation_id, "").await;
    assert_eq!(history[0].message_type, "text");
    assert_eq!(history[0].metadata, serde_json::json!({}));
}
```

Extend `tests/common/mod.rs` test DTOs:

```rust
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
```

- [ ] **Step 3: Run backend tests to confirm RED**

Run:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test schema --test messages_service
```

Expected: FAIL because `call_sessions`, `call_participants`, `messages.message_type`, and `messages.metadata` do not exist and DTO fields are missing.

- [ ] **Step 4: Add migration**

Create `migrations/0002_calls.sql`:

```sql
alter table messages
    add column message_type text not null default 'text',
    add column metadata jsonb not null default '{}'::jsonb;

alter table messages
    add constraint messages_message_type_check check (message_type in ('text', 'call_event'));

create table call_sessions (
    call_id uuid primary key,
    conversation_id uuid not null references conversations (conversation_id),
    caller_user_id bigint not null references users (user_id),
    callee_user_id bigint not null references users (user_id),
    caller_client_id uuid not null references clients (client_id),
    accepted_client_id uuid references clients (client_id),
    media_type text not null,
    state text not null,
    started_at timestamptz not null,
    accepted_at timestamptz,
    interruption_detected_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    created_message_id uuid references messages (message_id),
    constraint call_sessions_media_type_check check (media_type in ('audio', 'video')),
    constraint call_sessions_state_check check (state in ('ringing', 'connecting', 'active', 'ended')),
    constraint call_sessions_end_reason_check check (
        end_reason is null or end_reason in ('completed', 'rejected', 'canceled', 'timeout', 'busy', 'offline', 'network_error')
    ),
    constraint call_sessions_distinct_users_check check (caller_user_id <> callee_user_id),
    constraint call_sessions_ended_state_check check (
        (state = 'ended' and ended_at is not null and end_reason is not null)
        or (state <> 'ended' and ended_at is null and end_reason is null)
    )
);

create table call_participants (
    call_id uuid not null references call_sessions (call_id) on delete cascade,
    user_id bigint not null references users (user_id),
    role text not null,
    state text not null,
    primary key (call_id, user_id),
    constraint call_participants_role_check check (role in ('caller', 'callee')),
    constraint call_participants_state_check check (state in ('ringing', 'connecting', 'active', 'ended'))
);

create unique index call_participants_one_active_call_per_user_idx
    on call_participants (user_id)
    where state in ('ringing', 'connecting', 'active');

create index call_sessions_conversation_started_idx
    on call_sessions (conversation_id, started_at desc);

create index call_sessions_state_started_idx
    on call_sessions (state, started_at);
```

- [ ] **Step 5: Extend message DTOs and queries**

In `src/messages/types.rs`, add fields:

```rust
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
```

In `MessageDtoRow`, add `message_type: String` and `metadata: serde_json::Value`; select `m.message_type, m.metadata` in `message_dto_by_id` and `list_messages`; set inserted text messages to defaults by omitting the columns from existing text inserts.

In conversation summary DTO/query, include `m.message_type` and `m.metadata` for `latest_message`.

- [ ] **Step 6: Add call-event insert helper**

In `src/messages/service.rs`, add a helper that reuses the same sequence allocation path as text messages but bypasses text idempotency and sets `message_type = 'call_event'`:

```rust
pub async fn insert_call_event_message_in_locked_conversation(
    tx: &mut Transaction<'_, Postgres>,
    conversation: &ConversationRow,
    sender: &CurrentUser,
    body: String,
    metadata: serde_json::Value,
) -> AppResult<SendMessageResult> {
    if body.trim().is_empty() {
        return Err(AppError::unprocessable_request("Call event body must not be empty"));
    }

    let message_id = new_uuid_v7();
    let message_seq = conversation.last_message_seq + 1;
    let now = now_utc();
    let client_msg_id = format!("call-event-{message_id}");
    let body_hash = body_hash(&body);
    let request_fingerprint = request_fingerprint(conversation.conversation_id, &body_hash);

    sqlx::query(
        "insert into messages (
             message_id, conversation_id, message_seq, sender_user_id, client_id,
             client_msg_id, body, body_hash, request_fingerprint, message_type, metadata, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'call_event', $10, $11)",
    )
    .bind(message_id)
    .bind(conversation.conversation_id)
    .bind(message_seq)
    .bind(sender.user_id)
    .bind(sender.client_id)
    .bind(client_msg_id)
    .bind(&body)
    .bind(body_hash)
    .bind(request_fingerprint)
    .bind(metadata)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(internal_error)?;

    update_conversation_after_insert(tx, conversation.conversation_id, message_seq, message_id, now).await?;
    let message = message_dto_by_id(tx, message_id).await?;
    Ok(SendMessageResult { conversation_id: message.conversation_id, message, newly_created: true })
}
```

If `ConversationRow`, `body_hash`, `update_conversation_after_insert`, or `message_dto_by_id` are private, make them `pub(crate)` rather than duplicating logic.

- [ ] **Step 7: Update API docs**

In `docs/api.md`, update message examples to include:

```json
{
  "message_type": "text",
  "metadata": {}
}
```

Add a call-event example:

```json
{
  "message_type": "call_event",
  "body": "视频通话 03:12",
  "metadata": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "media_type": "video",
    "outcome": "completed",
    "duration_seconds": 192,
    "caller_user_id": "1001",
    "callee_user_id": "1002"
  }
}
```

- [ ] **Step 8: Verify GREEN**

Run:

```bash
cargo fmt --all --check
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test schema --test messages_service
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add migrations/0002_calls.sql src/messages src/conversations tests/common/mod.rs tests/schema.rs tests/messages_service.rs docs/api.md
git commit -m "feat: add call event message model"
```

---

### Task 2: Backend Calls Domain Service and Busy Locking

**Files:**
- Create: `src/calls/mod.rs`
- Create: `src/calls/types.rs`
- Create: `src/calls/service.rs`
- Modify: `src/lib.rs`
- Modify: `src/error.rs`
- Modify: `src/realtime/connection_registry.rs`
- Modify: `tests/common/mod.rs`
- Create: `tests/calls_service.rs`

**Interfaces:**
- Consumes: `messages::service::insert_call_event_message_in_locked_conversation`.
- Produces: `calls::service::invite` and shared internal helpers for later state transitions.
- Produces: `ConnectionRegistry::{is_user_online, contains_client, send_to_client}` for later WS routing.

- [ ] **Step 1: Write failing service tests for invite validation and busy locking**

Create `tests/calls_service.rs`:

```rust
mod common;

use nano_chat::{calls::{service as calls_service, types::CallMediaType}, error::ErrorCode};
use sqlx::Row;

#[tokio::test]
#[serial_test::serial]
async fn invite_requires_active_direct_conversation_and_online_callee() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    let group = ctx.create_group(&alice, "team", &[bob.user_id]).await;

    let offline = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .expect_err("offline callee should fail");
    assert_eq!(offline.code, ErrorCode::CalleeOffline);

    let group_error = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        group.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect_err("group calls are not supported");
    assert_eq!(group_error.code, ErrorCode::InvalidRequest);
}

#[tokio::test]
#[serial_test::serial]
async fn busy_lock_allows_only_one_non_ended_call_per_user() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let carol = ctx.register("carol").await;
    let alice_bob = ctx.send_direct_message(&alice, "bob", "ab", "hello").await;
    let carol_bob = ctx.send_direct_message(&carol, "bob", "cb", "hello").await;
    ctx.register_ws_sender_for(&bob);

    let first = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        alice_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect("first call should start");

    let busy = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        carol.current_user(),
        carol_bob.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .expect_err("bob should be globally busy");
    assert_eq!(busy.code, ErrorCode::CallBusy);

    let active_rows: i64 = sqlx::query_scalar(
        "select count(*) from call_participants where user_id = $1 and state in ('ringing', 'connecting', 'active')",
    )
    .bind(bob.user_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(active_rows, 1);
    assert_eq!(first.call.callee.user_id, bob.user_id);
}
```

Modify `tests/common/mod.rs` so `TestContext` keeps the same `AppState` used by the router:

```rust
pub struct TestContext {
    pub app: Router,
    pub pool: PgPool,
    pub state: AppState,
}

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
}
```

Keep all existing `TestContext` methods and fields not shown here unchanged.

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service
```

Expected: FAIL because `calls` module, error codes, and registry helpers do not exist.

- [ ] **Step 3: Add call types and error codes**

In `src/lib.rs`:

```rust
pub mod calls;
```

In `src/calls/mod.rs`:

```rust
pub mod service;
pub mod types;
```

In `src/error.rs`, add `CallBusy`, `CalleeOffline`, `CallNotFound`, `CallEnded`, and `NotCallParticipant` with string codes `call_busy`, `callee_offline`, `call_not_found`, `call_ended`, and `not_call_participant`.

In `src/calls/types.rs` define serde-friendly types:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{ids::UserId, users::types::UserSummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallMediaType { Audio, Video }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallState { Ringing, Connecting, Active, Ended }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallEndReason { Completed, Rejected, Canceled, Timeout, Busy, Offline, NetworkError }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallCommandResult {
    pub call: CallSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallSignalTarget {
    pub target_user_id: UserId,
    pub target_client_id: Uuid,
}
```

- [ ] **Step 4: Extend connection registry**

In `src/realtime/connection_registry.rs`, add methods:

```rust
pub fn is_user_online(&self, user_id: UserId) -> bool {
    self.connection_count_for_user(user_id) > 0
}

pub fn contains_client(&self, user_id: UserId, client_id: Uuid) -> bool {
    let inner = self.lock_inner();
    inner.by_user.get(&user_id).is_some_and(|connection_ids| {
        connection_ids.iter().any(|connection_id| {
            inner.connections
                .get(connection_id)
                .is_some_and(|connection| connection.client_id == client_id)
        })
    })
}

pub fn send_to_client(
    &self,
    user_id: UserId,
    client_id: Uuid,
    envelope: ServerEnvelope,
    skip_connection_id: Option<ConnectionId>,
) -> usize {
    let targets = {
        let inner = self.lock_inner();
        inner
            .by_user
            .get(&user_id)
            .into_iter()
            .flat_map(|ids| ids.iter())
            .filter(|connection_id| Some(**connection_id) != skip_connection_id)
            .filter_map(|connection_id| inner.connections.get(connection_id))
            .filter(|connection| connection.client_id == client_id)
            .map(|connection| connection.sender.clone())
            .collect::<Vec<_>>()
    };

    targets.into_iter().filter(|sender| sender.try_send(envelope.clone()).is_ok()).count()
}
```

Add unit tests beside existing registry tests for these methods.

- [ ] **Step 5: Implement `calls::service::invite` minimally**

Implement `invite` with this signature:

```rust
pub async fn invite(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    caller: CurrentUser,
    conversation_id: Uuid,
    media_type: CallMediaType,
) -> AppResult<CallCommandResult>
```

Implementation requirements:

1. Begin a transaction.
2. Lock the conversation row `for update`.
3. Require `conversations.type = 'direct'` and `state = 'active'`.
4. Find the other user in `conversation_members` as callee.
5. Require caller is one of the two members.
6. If `registry.is_user_online(callee_user_id)` is false, insert an ended `call_sessions` row with `end_reason = 'offline'`, insert an ended participant row for caller/callee, create one `call_event` message with outcome `offline`, commit, and return `CalleeOffline`.
7. Insert `call_sessions` with `state = 'ringing'`, caller/callee ids, `caller_client_id = caller.client_id`, and current time.
8. Insert two `call_participants` rows with `state = 'ringing'`.
9. If the partial unique index rejects either participant, rollback and return `CallBusy`. For callee busy, also create one ended busy call record in a fresh transaction.
10. Commit and return `CallCommandResult`.

- [ ] **Step 6: Verify service tests**

Run:

```bash
cargo fmt --all --check
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service
```

Expected: PASS for invite validation and busy tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib.rs src/error.rs src/calls src/realtime/connection_registry.rs tests/common/mod.rs tests/calls_service.rs
git commit -m "feat: add call lifecycle service skeleton"
```

---

### Task 3: Call State Transitions and Call Record Messages

**Files:**
- Modify: `src/calls/service.rs`
- Modify: `src/calls/types.rs`
- Modify: `tests/calls_service.rs`
- Modify: `docs/api.md`

**Interfaces:**
- Produces: `accept`, `connected`, `reject`, `cancel`, `hangup` service functions.
- Produces: exactly-one call record message for final states.

- [ ] **Step 1: Add failing state transition tests**

In `tests/calls_service.rs`, add:

```rust
#[tokio::test]
#[serial_test::serial]
async fn accept_connected_and_hangup_complete_call_with_duration_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Video,
    )
    .await
    .unwrap();

    let accepted = calls_service::accept(&ctx.pool, bob.current_user(), invited.call.call_id)
        .await
        .unwrap();
    assert_eq!(accepted.call.accepted_client_id, Some(bob.client_id));

    let active = calls_service::connected(&ctx.pool, alice.current_user(), invited.call.call_id)
        .await
        .unwrap();
    assert_eq!(active.call.state, nano_chat::calls::types::CallState::Active);

    let ended = calls_service::hangup(
        &ctx.pool,
        alice.current_user(),
        invited.call.call_id,
        nano_chat::calls::types::CallEndReason::Completed,
    )
    .await
    .unwrap();
    assert_eq!(ended.call.end_reason, Some(nano_chat::calls::types::CallEndReason::Completed));

    let history = ctx.messages(&alice, direct.conversation_id, "").await;
    let call_event = history.iter().find(|message| message.message_type == "call_event").unwrap();
    assert_eq!(call_event.metadata["call_id"], invited.call.call_id.to_string());
    assert_eq!(call_event.metadata["media_type"], "video");
    assert_eq!(call_event.metadata["outcome"], "completed");
    assert!(call_event.metadata["duration_seconds"].as_i64().unwrap() >= 0);
}

#[tokio::test]
#[serial_test::serial]
async fn reject_cancel_and_duplicate_end_create_one_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    ctx.register_ws_sender_for(&bob);

    let invited = calls_service::invite(
        &ctx.pool,
        &ctx.state.registry,
        alice.current_user(),
        direct.conversation_id,
        CallMediaType::Audio,
    )
    .await
    .unwrap();

    calls_service::reject(&ctx.pool, bob.current_user(), invited.call.call_id).await.unwrap();
    calls_service::reject(&ctx.pool, bob.current_user(), invited.call.call_id).await.unwrap();

    let record_count: i64 = sqlx::query_scalar(
        "select count(*) from messages where conversation_id = $1 and message_type = 'call_event'",
    )
    .bind(direct.conversation_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(record_count, 1);
}
```

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service
```

Expected: FAIL because transition functions are missing.

- [ ] **Step 3: Implement transition functions**

Add signatures:

```rust
pub async fn accept(pool: &PgPool, callee: CurrentUser, call_id: Uuid) -> AppResult<CallCommandResult>;
pub async fn connected(pool: &PgPool, participant: CurrentUser, call_id: Uuid) -> AppResult<CallCommandResult>;
pub async fn reject(pool: &PgPool, callee: CurrentUser, call_id: Uuid) -> AppResult<CallCommandResult>;
pub async fn cancel(pool: &PgPool, caller: CurrentUser, call_id: Uuid) -> AppResult<CallCommandResult>;
pub async fn hangup(pool: &PgPool, participant: CurrentUser, call_id: Uuid, reason: CallEndReason) -> AppResult<CallCommandResult>;
```

Implementation rules:

- Lock `call_sessions where call_id = $1 for update`.
- Verify participant role using `caller_user_id`/`callee_user_id`.
- `accept` only accepts `ringing` calls by callee; set `state = 'connecting'`, `accepted_at = now`, `accepted_client_id = callee.client_id`, and set both participant states to `connecting`.
- `connected` accepts caller or callee while `connecting`; set call and participant states to `active`.
- `reject` only accepts callee on `ringing`; end as `rejected`.
- `cancel` only accepts caller on `ringing`; end as `canceled`.
- `hangup` accepts either participant on `connecting`/`active`; allowed reasons are `completed` and `network_error`.
- If call is already ended, return the existing ended summary without inserting another message.
- Ending a call sets participant states to `ended`, releases the partial unique busy lock, inserts one call-event message, and sets `created_message_id`.

- [ ] **Step 4: Implement call record body and metadata mapping**

In `calls::service`, create:

```rust
fn call_record_body(media_type: CallMediaType, reason: CallEndReason, duration_seconds: Option<i64>) -> String {
    let media = match media_type { CallMediaType::Audio => "语音通话", CallMediaType::Video => "视频通话" };
    match reason {
        CallEndReason::Completed => format!("{media} {}", format_duration(duration_seconds.unwrap_or(0))),
        CallEndReason::Rejected => format!("{media} 已拒绝"),
        CallEndReason::Canceled => format!("{media} 已取消"),
        CallEndReason::Timeout => format!("{media} 超时未接"),
        CallEndReason::Busy => format!("{media} 忙线未接通"),
        CallEndReason::Offline => format!("{media} 对方离线"),
        CallEndReason::NetworkError => format!("{media} 网络中断"),
    }
}

fn format_duration(seconds: i64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    format!("{minutes:02}:{seconds:02}")
}
```

Metadata must include `call_id`, `media_type`, `outcome`, `duration_seconds`, `caller_user_id`, and `callee_user_id`.

- [ ] **Step 5: Update docs**

In `docs/api.md`, add a call record outcome table with exact outcome strings: `completed`, `rejected`, `canceled`, `timeout`, `busy`, `offline`, `network_error`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
cargo fmt --all --check
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service --test messages_service
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/calls tests/calls_service.rs docs/api.md
git commit -m "feat: add call state transitions"
```

---

### Task 4: WebSocket Call Commands and Realtime Events

**Files:**
- Modify: `src/ws/protocol.rs`
- Modify: `src/ws/handler.rs`
- Modify: `src/realtime/types.rs`
- Modify: `src/realtime/notify.rs`
- Modify: `tests/ws_protocol.rs`
- Modify: `tests/common/mod.rs`
- Create: `tests/calls_ws_e2e.rs`
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: `calls::service` lifecycle functions.
- Produces: WebSocket commands `call.invite`, `call.accept`, `call.connected`, `call.reject`, `call.cancel`, `call.hangup`, `call.signal`.
- Produces: server events `call.incoming`, `call.ringing`, `call.accepted`, `call.connected`, `call.rejected`, `call.canceled`, `call.ended`, `call.busy`, `call.signal`.

- [ ] **Step 1: Write failing protocol tests**

In `tests/ws_protocol.rs`, add serde tests:

```rust
#[test]
fn call_invite_payload_deserializes() {
    let envelope: nano_chat::ws::protocol::ClientEnvelope = serde_json::from_value(json!({
        "id": "call-1",
        "type": "call.invite",
        "payload": {"conversation_id": uuid::Uuid::nil(), "media_type": "video"}
    }))
    .unwrap();
    assert_eq!(envelope.message_type, "call.invite");
}

#[test]
fn call_signal_payload_accepts_offer_answer_and_ice() {
    let payload: nano_chat::ws::protocol::CallSignalPayload = serde_json::from_value(json!({
        "call_id": uuid::Uuid::nil(),
        "signal_type": "offer",
        "data": {"type": "offer", "sdp": "v=0"}
    }))
    .unwrap();
    assert_eq!(payload.signal_type, nano_chat::ws::protocol::CallSignalType::Offer);
}
```

- [ ] **Step 2: Write failing WS e2e tests**

Create `tests/calls_ws_e2e.rs` using the `tests/ws_e2e.rs` server pattern. Include one test for multi-client ringing and targeted signal:

```rust
#[tokio::test]
#[serial_test::serial]
async fn call_invite_rings_all_callee_clients_and_accept_targets_signal() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob_phone = ctx.register("bob").await;
    let bob_desktop = ctx.login_existing_client("bob", None).await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    let (addr, server) = spawn_ws_server(ctx.app.clone()).await;

    let mut alice_ws = connect_user(&addr, &alice).await;
    let mut bob_phone_ws = connect_user(&addr, &bob_phone).await;
    let mut bob_desktop_ws = connect_user(&addr, &bob_desktop).await;

    alice_ws.send_json(json!({
        "id":"invite-1",
        "type":"call.invite",
        "payload":{"conversation_id": direct.conversation_id, "media_type":"video"}
    })).await;

    let alice_ack = alice_ws.next_json().await;
    assert_eq!(alice_ack["type"], "call.invite.ok");
    let call_id = alice_ack["payload"]["call"]["call_id"].as_str().unwrap().to_string();

    assert_eq!(bob_phone_ws.next_json().await["type"], "call.incoming");
    assert_eq!(bob_desktop_ws.next_json().await["type"], "call.incoming");

    bob_desktop_ws.send_json(json!({"id":"accept-1", "type":"call.accept", "payload":{"call_id": call_id}})).await;
    assert_eq!(bob_desktop_ws.next_json().await["type"], "call.accept.ok");
    assert_eq!(bob_phone_ws.next_json().await["type"], "call.accepted");

    alice_ws.send_json(json!({
        "id":"signal-1",
        "type":"call.signal",
        "payload":{"call_id": call_id, "signal_type":"offer", "data":{"type":"offer", "sdp":"v=0"}}
    })).await;
    assert_eq!(alice_ws.next_json().await["type"], "call.signal.ok");
    let signal = bob_desktop_ws.next_json().await;
    assert_eq!(signal["type"], "call.signal");
    assert_eq!(signal["payload"]["signal_type"], "offer");

    server.abort();
}
```

Add `TestContext::login_existing_client(username, client_id)` to `tests/common/mod.rs`:

```rust
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
```

Add helpers in `tests/calls_ws_e2e.rs` rather than broad common changes: `spawn_ws_server`, `connect_user`, `send_json`, and `next_json` based on `tests/ws_e2e.rs`.

- [ ] **Step 3: Run tests to confirm RED**

Run:

```bash
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test ws_protocol --test calls_ws_e2e
```

Expected: FAIL because payload types, handlers, login helper, and events are missing.

- [ ] **Step 4: Add WebSocket protocol payloads**

In `src/ws/protocol.rs`, add:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct CallInvitePayload {
    pub conversation_id: Uuid,
    pub media_type: crate::calls::types::CallMediaType,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CallIdPayload { pub call_id: Uuid }

#[derive(Debug, Clone, Deserialize)]
pub struct CallHangupPayload {
    pub call_id: Uuid,
    #[serde(default)]
    pub reason: Option<crate::calls::types::CallEndReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CallSignalType { Offer, Answer, IceCandidate }

#[derive(Debug, Clone, Deserialize)]
pub struct CallSignalPayload {
    pub call_id: Uuid,
    pub signal_type: CallSignalType,
    pub data: serde_json::Value,
}
```

- [ ] **Step 5: Add call realtime event variants**

In `src/realtime/types.rs`, add serializable event variants for state events. Do not add SDP/ICE data to Postgres NOTIFY payloads. `call.signal` is delivered directly from `ws::handler` with `ServerEnvelope::event` and `registry.send_to_client`.

Call state event variants:

```rust
CallIncoming { call: CallSummary },
CallRinging { call: CallSummary },
CallAccepted { call: CallSummary },
CallConnected { call: CallSummary },
CallRejected { call: CallSummary },
CallCanceled { call: CallSummary },
CallEnded { call: CallSummary },
CallBusy { call: CallSummary },
```

`event_type()` must return the exact string names from the spec.

In `src/realtime/notify.rs`, route call state events to `caller_user_id` and `callee_user_id` from the embedded call summary.

- [ ] **Step 6: Dispatch call commands**

In `src/ws/handler.rs`, add match arms:

```rust
"call.invite" => handle_call_invite(state, current_user, connection_id, outbound_tx, envelope).await,
"call.accept" => handle_call_accept(state, current_user, connection_id, outbound_tx, envelope).await,
"call.connected" => handle_call_connected(state, current_user, connection_id, outbound_tx, envelope).await,
"call.reject" => handle_call_reject(state, current_user, connection_id, outbound_tx, envelope).await,
"call.cancel" => handle_call_cancel(state, current_user, connection_id, outbound_tx, envelope).await,
"call.hangup" => handle_call_hangup(state, current_user, connection_id, outbound_tx, envelope).await,
"call.signal" => handle_call_signal(state, current_user, connection_id, outbound_tx, envelope).await,
```

Each lifecycle handler parses payload, calls `calls::service`, sends `*.ok`, and publishes the matching state event. `handle_call_signal` must:

1. Parse `CallSignalPayload`.
2. Ask `calls::service::signal_target(&state.pool, current_user, payload.call_id)` for the target user/client.
3. Send `call.signal` directly with `state.registry.send_to_client(target_user_id, target_client_id, envelope, Some(connection_id))`.
4. Send `call.signal.ok` to origin.
5. Never publish SDP/ICE data through `state.notify_publisher`.

- [ ] **Step 7: Document WebSocket protocol**

In `docs/api.md`, add command and event JSON examples for invite, accept, connected, hangup, and signal. The `call.signal` example must show `offer`, `answer`, and `ice_candidate` signal types.

- [ ] **Step 8: Verify GREEN**

Run:

```bash
cargo fmt --all --check
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test ws_protocol --test calls_ws_e2e --test realtime_notify
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ws src/realtime src/calls tests/ws_protocol.rs tests/calls_ws_e2e.rs docs/api.md
git commit -m "feat: add call websocket signaling"
```

---

### Task 5: Call Timeout, Disconnect Grace, and Startup Cleanup

**Files:**
- Modify: `src/config.rs`
- Modify: `src/app.rs`
- Modify: `src/main.rs`
- Modify: `src/ws/handler.rs`
- Modify: `src/calls/service.rs`
- Modify: `tests/calls_service.rs`
- Modify: `.env.example`
- Modify: `docs/api.md`

**Interfaces:**
- Produces: `calls::service::cleanup_timed_out_calls(pool, now, ringing_timeout) -> AppResult<Vec<CallCommandResult>>`.
- Produces: `calls::service::cleanup_interrupted_calls(pool, registry, now, grace) -> AppResult<Vec<CallCommandResult>>`.
- Produces: `calls::service::cleanup_non_ended_calls_on_startup(pool) -> AppResult<u64>`.

- [ ] **Step 1: Write failing cleanup tests**

In `tests/calls_service.rs`, add:

```rust
#[tokio::test]
#[serial_test::serial]
async fn ringing_timeout_ends_call_and_writes_one_timeout_record() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    ctx.register_ws_sender_for(&bob);
    let invited = calls_service::invite(&ctx.pool, &ctx.state.registry, alice.current_user(), direct.conversation_id, CallMediaType::Audio).await.unwrap();

    sqlx::query("update call_sessions set started_at = now() - interval '61 seconds' where call_id = $1")
        .bind(invited.call.call_id)
        .execute(&ctx.pool)
        .await
        .unwrap();

    let ended = calls_service::cleanup_timed_out_calls(&ctx.pool, chrono::Utc::now(), chrono::Duration::seconds(60))
        .await
        .unwrap();
    assert_eq!(ended.len(), 1);
    assert_eq!(ended[0].call.end_reason, Some(nano_chat::calls::types::CallEndReason::Timeout));

    let count: i64 = sqlx::query_scalar("select count(*) from messages where conversation_id = $1 and message_type = 'call_event'")
        .bind(direct.conversation_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
```

Add a startup cleanup test:

```rust
#[tokio::test]
#[serial_test::serial]
async fn startup_cleanup_marks_non_ended_calls_network_error() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let bob = ctx.register("bob").await;
    let direct = ctx.send_direct_message(&alice, "bob", "seed", "hello").await;
    ctx.register_ws_sender_for(&bob);
    let invited = calls_service::invite(&ctx.pool, &ctx.state.registry, alice.current_user(), direct.conversation_id, CallMediaType::Video).await.unwrap();

    let cleaned = calls_service::cleanup_non_ended_calls_on_startup(&ctx.pool).await.unwrap();
    assert_eq!(cleaned, 1);

    let reason: String = sqlx::query_scalar("select end_reason from call_sessions where call_id = $1")
        .bind(invited.call.call_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(reason, "network_error");
}
```

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service
```

Expected: FAIL because cleanup functions and config do not exist.

- [ ] **Step 3: Add config values**

In `Config`, add:

```rust
pub call_ringing_timeout_secs: u64,
pub call_disconnect_grace_secs: u64,
pub call_cleanup_interval_secs: u64,
```

Defaults:

- `NANO_CHAT_CALL_RINGING_TIMEOUT_SECS=60`
- `NANO_CHAT_CALL_DISCONNECT_GRACE_SECS=15`
- `NANO_CHAT_CALL_CLEANUP_INTERVAL_SECS=5`

Update `.env.example`, config tests, and `tests/common::test_config()`.

- [ ] **Step 4: Implement cleanup functions**

`cleanup_timed_out_calls`:

- Finds `state = 'ringing'` calls with `started_at < now - ringing_timeout`.
- Ends each with `timeout` through the same finalization path used by `reject` and `hangup`.
- Returns ended summaries.

`cleanup_interrupted_calls`:

- Finds `connecting`/`active` calls.
- Uses `registry.contains_client(caller_user_id, caller_client_id)` and, when present, `registry.contains_client(callee_user_id, accepted_client_id)`.
- If either selected client is missing longer than the grace period, ends as `network_error`.
- Store disconnect detection in the nullable `call_sessions.interruption_detected_at` column created by Task 1. The first cleanup pass that notices a selected client missing sets this timestamp; a later pass after the grace duration ends the call as `network_error`. If both selected clients are present again, clear `interruption_detected_at`.

`cleanup_non_ended_calls_on_startup`:

- Ends all non-ended calls as `network_error`.
- Inserts one call-event message per call.
- Returns the number of calls ended.

- [ ] **Step 5: Wire lifecycle cleanup**

In `main.rs`, after migrations/pool/state setup and before serving, call:

```rust
calls::service::cleanup_non_ended_calls_on_startup(&state.pool).await?;
```

Start a Tokio task that ticks every `call_cleanup_interval_secs`, calls timeout cleanup and interrupted cleanup, then publishes `call.ended` for each returned summary.

In `ws::handler`, keep unregister behavior as-is; cleanup is handled by the background task using registry visibility.

- [ ] **Step 6: Update docs**

In `docs/api.md`, document ringing timeout and disconnect grace as deployment behavior. In `.env.example`, include all three call cleanup env vars.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cargo fmt --all --check
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_service --test ws_e2e --test readiness_http
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config.rs src/app.rs src/main.rs src/ws/handler.rs src/calls tests/calls_service.rs .env.example docs/api.md migrations
git commit -m "feat: add call cleanup lifecycle"
```

---

### Task 6: ICE Server Endpoint and TURN Shared-Secret Credentials

**Files:**
- Modify: `Cargo.toml`
- Create: `src/calls/ice.rs`
- Create: `src/calls/http.rs`
- Modify: `src/calls/mod.rs`
- Modify: `src/config.rs`
- Modify: `src/app.rs`
- Create: `tests/calls_http.rs`
- Modify: `.env.example`
- Modify: `docs/api.md`

**Interfaces:**
- Produces: `GET /api/v1/calls/ice-servers`.
- Produces: `calls::ice::generate_turn_credentials(secret, user_id, client_id, ttl, now) -> TurnCredentials`.

- [ ] **Step 1: Write failing ICE tests**

Create `tests/calls_http.rs`:

```rust
mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn ice_servers_requires_authentication() {
    let ctx = common::TestContext::new().await;
    let request = common::json_request("GET", "/api/v1/calls/ice-servers", serde_json::json!({}));
    let response = ctx.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial_test::serial]
async fn ice_servers_returns_short_lived_turn_credentials() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let request = common::authed_empty_request("GET", "/api/v1/calls/ice-servers", &alice);
    let response = ctx.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = common::response_json(response).await;

    let ice_servers = body["ice_servers"].as_array().unwrap();
    assert!(ice_servers.iter().any(|server| server["urls"].as_array().unwrap().iter().any(|url| url == "stun:turn.example.com:3478")));
    let turn = ice_servers.iter().find(|server| server["username"].is_string()).unwrap();
    assert!(turn["username"].as_str().unwrap().contains(&alice.user_id.to_string()));
    assert!(turn["credential"].as_str().unwrap().len() > 20);
    assert!(body["expires_at"].as_str().unwrap().ends_with('Z'));
}
```

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_http
```

Expected: FAIL because the route/config does not exist.

- [ ] **Step 3: Add dependencies and config**

In `Cargo.toml`, add:

```toml
base64 = "0.22"
hmac = "0.12"
sha1 = "0.10"
```

In `Config`, add:

```rust
pub turn_public_host: String,
pub turn_realm: String,
pub turn_shared_secret: String,
pub turn_credential_ttl_secs: u64,
pub turn_udp_url: String,
pub turn_tcp_url: String,
pub stun_url: String,
```

Defaults for local tests:

- `TURN_PUBLIC_HOST=turn.example.com`
- `TURN_REALM=turn.example.com`
- `TURN_SHARED_SECRET=change-me-turn-shared-secret-at-least-32-bytes`
- `TURN_CREDENTIAL_TTL_SECS=600`
- `TURN_STUN_URL=stun:turn.example.com:3478`
- `TURN_UDP_URL=turn:turn.example.com:3478?transport=udp`
- `TURN_TCP_URL=turn:turn.example.com:3478?transport=tcp`

Require `TURN_SHARED_SECRET` length >= 32 when explicitly set or defaulted.

- [ ] **Step 4: Implement TURN credential generation**

In `src/calls/ice.rs`:

```rust
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;
use uuid::Uuid;
use crate::ids::UserId;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TurnCredentials {
    pub username: String,
    pub credential: String,
    pub expires_at: DateTime<Utc>,
}

pub fn generate_turn_credentials(
    secret: &str,
    user_id: UserId,
    client_id: Uuid,
    ttl: Duration,
    now: DateTime<Utc>,
) -> TurnCredentials {
    let expires_at = now + ttl;
    let username = format!("{}:{}:{}", expires_at.timestamp(), user_id, client_id);
    let mut mac = HmacSha1::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(username.as_bytes());
    let credential = STANDARD.encode(mac.finalize().into_bytes());
    TurnCredentials { username, credential, expires_at }
}
```

Add unit tests verifying deterministic output for a fixed secret, user id, client id, and time.

- [ ] **Step 5: Implement HTTP route**

In `src/calls/http.rs`, add an authenticated router:

```rust
pub fn router() -> Router<AppState> {
    Router::new().route("/calls/ice-servers", get(get_ice_servers))
}
```

Handler behavior:

- Authenticate using existing bearer extractor/service pattern used by other HTTP modules.
- Generate credentials with config TTL.
- Return:

```json
{
  "ice_servers": [
    { "urls": ["stun:turn.example.com:3478"] },
    { "urls": ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"], "username": "...", "credential": "..." }
  ],
  "expires_at": "2026-07-01T00:10:00.000Z"
}
```

Merge `calls::http::router()` in `src/app.rs` under `/api/v1`.

- [ ] **Step 6: Update docs and env**

Document `GET /api/v1/calls/ice-servers` in `docs/api.md`. Add TURN env vars to `.env.example`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cargo fmt --all --check
cargo test --lib
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test calls_http --test auth_http
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock src/calls src/config.rs src/app.rs tests/calls_http.rs .env.example docs/api.md
git commit -m "feat: add turn ice server endpoint"
```

---

### Task 7: Single-VPS Caddy and coturn Deployment

**Files:**
- Modify: `docker-compose.yml`
- Create: `Caddyfile`
- Create: `coturn/turnserver.conf`
- Modify: `.env.example`
- Modify: `docs/api.md`
- Create: `docs/deployment-webrtc.md`
- Create: `tests/deployment_config.rs`

**Interfaces:**
- Produces: Docker Compose services `caddy` and `coturn`.
- Produces: deployment documentation for HTTPS and TURN firewall ports.

- [ ] **Step 1: Write failing static deployment tests**

Create `tests/deployment_config.rs`:

```rust
#[test]
fn compose_declares_caddy_and_coturn_services() {
    let compose = std::fs::read_to_string("docker-compose.yml").unwrap();
    assert!(compose.contains("  caddy:"));
    assert!(compose.contains("  coturn:"));
    assert!(compose.contains("80:80"));
    assert!(compose.contains("443:443"));
    assert!(compose.contains("3478:3478/udp"));
    assert!(compose.contains("3478:3478/tcp"));
}

#[test]
fn coturn_uses_shared_secret_and_relay_range() {
    let config = std::fs::read_to_string("coturn/turnserver.conf").unwrap();
    assert!(config.contains("use-auth-secret"));
    assert!(config.contains("static-auth-secret="));
    assert!(config.contains("min-port=49160"));
    assert!(config.contains("max-port=49200"));
}
```

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
cargo test --test deployment_config
```

Expected: FAIL because files/services are missing.

- [ ] **Step 3: Add Caddyfile**

Create `Caddyfile`:

```caddyfile
{$NANO_CHAT_DOMAIN} {
    encode zstd gzip
    reverse_proxy app:3000
}
```

- [ ] **Step 4: Add coturn config**

Create `coturn/turnserver.conf`:

```conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${TURN_SHARED_SECRET}
realm=${TURN_REALM}
server-name=${TURN_REALM}
no-multicast-peers
no-cli
no-tls
no-dtls
min-port=49160
max-port=49200
log-file=stdout
simple-log
```

- [ ] **Step 5: Update Docker Compose**

Modify `docker-compose.yml`:

- Add `caddy` profile `app` with `caddy:2`, ports `80:80`, `443:443`, mounted `Caddyfile`, and caddy data/config volumes.
- Make `app` expose `3000` inside Docker network and avoid publishing `APP_PORT` when `caddy` is active.
- Add `coturn` service using `coturn/coturn:4`, command `-c /etc/coturn/turnserver.conf`, env vars `TURN_SHARED_SECRET` and `TURN_REALM`, ports `3478:3478/udp`, `3478:3478/tcp`, and `49160-49200:49160-49200/udp`.

- [ ] **Step 6: Update env and deployment docs**

In `.env.example`, add:

```env
NANO_CHAT_DOMAIN=chat.example.com
TURN_PUBLIC_HOST=turn.example.com
TURN_REALM=turn.example.com
TURN_SHARED_SECRET=change-me-turn-shared-secret-at-least-32-bytes
TURN_CREDENTIAL_TTL_SECS=600
TURN_STUN_URL=stun:turn.example.com:3478
TURN_UDP_URL=turn:turn.example.com:3478?transport=udp
TURN_TCP_URL=turn:turn.example.com:3478?transport=tcp
TURN_RELAY_MIN_PORT=49160
TURN_RELAY_MAX_PORT=49200
```

Create `docs/deployment-webrtc.md` with exact firewall requirements:

```md
# WebRTC Single-VPS Deployment

Open inbound TCP 80 and 443 for Caddy.
Open inbound UDP 3478 and TCP 3478 for coturn.
Open inbound UDP 49160-49200 for TURN relay traffic.
Set NANO_CHAT_DOMAIN to the HTTPS app host.
Set TURN_PUBLIC_HOST and TURN_REALM to the TURN host.
Use the same TURN_SHARED_SECRET for the app and coturn.
Run: docker compose --profile app up -d --build
```

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cargo test --test deployment_config
docker compose config >/tmp/nano-chat-compose-rendered.yml
```

Expected: test PASS and `docker compose config` exits 0.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml Caddyfile coturn/turnserver.conf .env.example docs/api.md docs/deployment-webrtc.md tests/deployment_config.rs
git commit -m "chore: add caddy coturn deployment"
```

---

### Task 8: Frontend Protocol, API, and Call Record Rendering

**Files:**
- Modify: `web/src/shared/api/types.ts`
- Modify: `web/src/shared/api/client.ts`
- Modify: `web/src/shared/api/client.test.ts`
- Modify: `web/src/shared/realtime/protocol.ts`
- Modify: `web/src/shared/realtime/protocol.type-test.ts`
- Modify: `web/src/shared/realtime/realtimeClient.test.ts`
- Modify: `web/src/shared/utils/message.ts`
- Modify: `web/src/features/im/components/MessageList.tsx`
- Modify: `web/src/features/im/components/MessageList.test.tsx`
- Modify: `web/src/shared/i18n/resources.ts`

**Interfaces:**
- Produces: TypeScript call command/event types.
- Produces: `apiClient.getIceServers(): Promise<IceServersResponse>`.
- Produces: message rendering for `message_type: "call_event"`.

- [ ] **Step 1: Write failing frontend tests**

In `web/src/shared/api/client.test.ts`, add:

```ts
it("fetches ICE servers from the calls endpoint", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      ice_servers: [{ urls: ["stun:turn.example.com:3478"] }],
      expires_at: "2026-07-01T00:10:00.000Z",
    }), { status: 200 }),
  );
  const client = createApiClient({
    baseUrl: "/api/v1",
    getAccessToken: () => "token",
    onUnauthorized: vi.fn(),
    fetchImpl,
  });

  await expect(client.getIceServers()).resolves.toEqual({
    ice_servers: [{ urls: ["stun:turn.example.com:3478"] }],
    expires_at: "2026-07-01T00:10:00.000Z",
  });
  expect(fetchImpl).toHaveBeenCalledWith("/api/v1/calls/ice-servers", expect.objectContaining({ method: "GET" }));
});
```

In `web/src/features/im/components/MessageList.test.tsx`, add a call event rendering test:

```tsx
it("renders completed video call event messages", () => {
  render(
    <MessageList
      currentUserId="1001"
      hasLoadedAllKnownHistory
      isFetchingOlder={false}
      isLoading={false}
      isNearBottom
      loadOlder={vi.fn()}
      messages={[{
        message_id: "m1",
        conversation_id: "c1",
        message_seq: 1,
        sender: { user_id: "1001", username: "alice", display_name: "Alice" },
        body: "视频通话 03:12",
        message_type: "call_event",
        metadata: { media_type: "video", outcome: "completed", duration_seconds: 192 },
        created_at: "2026-07-01T00:00:00.000Z",
      }]}
      onNearBottomChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

  expect(screen.getByText("视频通话 03:12")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
cd web && pnpm test -- src/shared/api/client.test.ts src/features/im/components/MessageList.test.tsx
cd web && pnpm typecheck
```

Expected: FAIL because types and API client method are missing.

- [ ] **Step 3: Add shared TypeScript DTOs**

In `web/src/shared/api/types.ts`, extend messages:

```ts
export type MessageType = "text" | "call_event";
export type CallMediaType = "audio" | "video";
export type CallEndReason = "completed" | "rejected" | "canceled" | "timeout" | "busy" | "offline" | "network_error";

export type CallEventMetadata = {
  call_id?: string;
  media_type?: CallMediaType;
  outcome?: CallEndReason;
  duration_seconds?: number;
  caller_user_id?: string;
  callee_user_id?: string;
};

export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export type IceServersResponse = {
  ice_servers: IceServer[];
  expires_at: string;
};
```

Add `message_type: MessageType` and `metadata: Record<string, unknown>` to `Message` and `LatestMessageSummary`.

- [ ] **Step 4: Add API client method**

In `ApiClient`:

```ts
getIceServers(): Promise<IceServersResponse>;
```

Implementation:

```ts
getIceServers() {
  return request<IceServersResponse>("/calls/ice-servers");
}
```

- [ ] **Step 5: Add realtime protocol types**

In `web/src/shared/realtime/protocol.ts`, add call command types to `ClientCommandType` and `ClientCommandPayloadByType`. Add event union members for `call.incoming`, `call.ringing`, `call.accepted`, `call.connected`, `call.rejected`, `call.canceled`, `call.ended`, `call.busy`, and `call.signal`.

Use these shapes:

```ts
export type CallSummary = {
  call_id: string;
  conversation_id: string;
  caller: UserSummary;
  callee: UserSummary;
  caller_client_id: string;
  accepted_client_id: string | null;
  media_type: "audio" | "video";
  state: "ringing" | "connecting" | "active" | "ended";
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  end_reason: CallEndReason | null;
};

export type CallSignalPayload = {
  call_id: string;
  signal_type: "offer" | "answer" | "ice_candidate";
  data: unknown;
};
```

- [ ] **Step 6: Render call-event messages**

In `MessageList.tsx`, branch before normal bubble rendering:

```tsx
if (message.message_type === "call_event") {
  return <CallEventMessage message={message} />;
}
```

`CallEventMessage` renders a centered pill with `message.body`. Keep the backend body as the display source for first version so i18n does not need to reconstruct all outcomes.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cd web && pnpm lint
cd web && pnpm typecheck
cd web && pnpm test -- src/shared/api/client.test.ts src/shared/realtime/protocol.type-test.ts src/features/im/components/MessageList.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/shared/api web/src/shared/realtime web/src/shared/utils/message.ts web/src/features/im/components/MessageList.tsx web/src/features/im/components/MessageList.test.tsx web/src/shared/i18n/resources.ts
git commit -m "feat: render call event messages"
```

---

### Task 9: Frontend Call Engine, Provider, and UI Integration

**Files:**
- Create: `web/src/features/calls/CallEngine.ts`
- Create: `web/src/features/calls/CallEngine.test.ts`
- Create: `web/src/features/calls/CallProvider.tsx`
- Create: `web/src/features/calls/CallProvider.test.tsx`
- Create: `web/src/features/calls/components/ChatHeaderCallButtons.tsx`
- Create: `web/src/features/calls/components/IncomingCallDialog.tsx`
- Create: `web/src/features/calls/components/CallOverlay.tsx`
- Create: `web/src/features/calls/components/CallControls.tsx`
- Create: `web/src/features/calls/components/CallVideo.tsx`
- Create: `web/src/features/calls/components/CallUi.test.tsx`
- Modify: `web/src/features/im/components/ChatView.tsx`
- Modify: `web/src/features/shell/AuthenticatedAppLayout.tsx`
- Modify: `web/src/shared/i18n/resources.ts`

**Interfaces:**
- Consumes: `apiClient.getIceServers()`.
- Consumes: `RealtimeClient.sendCommand()` and call realtime events.
- Produces: `useCall()` with `startCall`, `acceptIncoming`, `rejectIncoming`, `cancelOutgoing`, `hangUp`, `toggleMuted`, and `toggleCamera`.

- [ ] **Step 1: Write failing CallEngine tests**

Create `web/src/features/calls/CallEngine.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CallEngine } from "./CallEngine";

it("starts local media before creating an offer", async () => {
  const localStream = new MediaStream();
  const getUserMedia = vi.fn().mockResolvedValue(localStream);
  const peer = createFakePeerConnection();
  const engine = new CallEngine({
    createPeerConnection: () => peer,
    getUserMedia,
    getIceServers: vi.fn().mockResolvedValue([{ urls: ["stun:turn.example.com:3478"] }]),
  });

  await engine.prepareLocalMedia("video");
  const offer = await engine.createOffer();

  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
  expect(peer.addTrack).toHaveBeenCalled();
  expect(offer.type).toBe("offer");
});

function createFakePeerConnection() {
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
    createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "v=0" }),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    addIceCandidate: vi.fn(),
    close: vi.fn(),
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
  };
}
```

- [ ] **Step 2: Write failing provider/UI tests**

Create `web/src/features/calls/CallProvider.test.tsx`:

```tsx
it("sends call.invite after media permission succeeds", async () => {
  const realtimeClient = createFakeRealtimeClient();
  const apiClient = createFakeApiClient();
  const engine = createFakeCallEngine();
  renderWithProviders(
    <CallProvider engine={engine}>
      <StartCallProbe conversation={directConversation} mediaType="audio" />
    </CallProvider>,
    { apiClient, realtimeClient },
  );

  await userEvent.click(screen.getByRole("button", { name: "start" }));

  expect(engine.prepareLocalMedia).toHaveBeenCalledWith("audio");
  expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.invite", {
    conversation_id: directConversation.conversation_id,
    media_type: "audio",
  });
});
```

Create `web/src/features/calls/components/CallUi.test.tsx`:

```tsx
it("renders audio and video call buttons for direct conversations", () => {
  render(<ChatHeaderCallButtons conversation={directConversation} disabled={false} />);
  expect(screen.getByRole("button", { name: /语音通话/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /视频通话/ })).toBeEnabled();
});

it("does not render call buttons for group conversations", () => {
  render(<ChatHeaderCallButtons conversation={groupConversation} disabled={false} />);
  expect(screen.queryByRole("button", { name: /语音通话/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to confirm RED**

Run:

```bash
cd web && pnpm test -- src/features/calls/CallEngine.test.ts src/features/calls/CallProvider.test.tsx src/features/calls/components/CallUi.test.tsx
```

Expected: FAIL because calls feature files do not exist.

- [ ] **Step 4: Implement `CallEngine`**

`CallEngine` constructor:

```ts
export type CallEngineDeps = {
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getIceServers: () => Promise<RTCIceServer[]>;
};
```

Public methods:

```ts
prepareLocalMedia(mediaType: "audio" | "video"): Promise<MediaStream>;
createOffer(): Promise<RTCSessionDescriptionInit>;
acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
toggleMuted(): boolean;
toggleCamera(): boolean;
close(): void;
subscribe(listener: (event: CallEngineEvent) => void): () => void;
```

Implementation requirements:

- `audio` uses `{ audio: true, video: false }`.
- `video` uses `{ audio: true, video: true }`.
- Fetch ICE servers before constructing `RTCPeerConnection`.
- Add all local tracks to the peer connection.
- Emit `ice_candidate`, `remote_stream`, `connected`, `failed`, and `closed` engine events.
- `toggleMuted` toggles enabled state for audio tracks and returns the new muted boolean.
- `toggleCamera` toggles enabled state for video tracks and returns the new camera-off boolean.
- `close` stops local tracks and closes the peer connection.

- [ ] **Step 5: Implement `CallProvider`**

State union:

```ts
export type CallUiState =
  | { phase: "idle" }
  | { phase: "outgoing"; call: CallSummary }
  | { phase: "incoming"; call: CallSummary }
  | { phase: "connecting"; call: CallSummary; localStream: MediaStream | null; remoteStream: MediaStream | null }
  | { phase: "active"; call: CallSummary; localStream: MediaStream | null; remoteStream: MediaStream | null; muted: boolean; cameraOff: boolean }
  | { phase: "ended"; call: CallSummary; reason: string };
```

Context methods:

```ts
startCall(conversation: ConversationSummary, mediaType: "audio" | "video"): Promise<void>;
acceptIncoming(): Promise<void>;
rejectIncoming(): Promise<void>;
cancelOutgoing(): Promise<void>;
hangUp(reason?: "completed" | "network_error"): Promise<void>;
toggleMuted(): void;
toggleCamera(): void;
```

Provider behavior:

- On `startCall`, require `conversation.type === "direct"`, call `engine.prepareLocalMedia(mediaType)`, then send `call.invite`.
- On `call.incoming`, set `incoming` unless already in a non-idle call.
- On `acceptIncoming`, prepare media, send `call.accept`, and wait for signaling.
- On `call.accepted` at caller, call `engine.createOffer()` and send `call.signal` with `offer`.
- On incoming `offer`, callee calls `engine.acceptOffer()` and sends `answer`.
- On incoming `answer`, caller calls `engine.acceptAnswer()`.
- On ICE engine event, send `call.signal` with `ice_candidate`.
- On engine `connected`, send `call.connected` once and set active.
- On engine `failed`, send `call.hangup` with `network_error`.
- On `call.ended`, close engine and show ended reason.

- [ ] **Step 6: Implement UI components**

`ChatHeaderCallButtons`:

- Render nothing unless `conversation.type === "direct"`.
- Render two icon buttons with labels from i18n: `calls.actions.audio` and `calls.actions.video`.
- Disable when conversation is not active or call state is not idle.

`IncomingCallDialog`:

- Render when `state.phase === "incoming"`.
- Show caller display name and audio/video label.
- Buttons: accept, reject.
- Try to play a short ringtone using an `HTMLAudioElement`; if playback rejects, ignore and rely on visual prompt.

`CallOverlay`:

- Render for outgoing, connecting, active, and ended phases.
- Desktop: fixed bottom/right panel.
- Mobile: fixed full-screen panel using responsive classes.
- Render local/remote `<video>` elements for video calls; render avatar-style fallback for audio calls.
- Controls: mute, camera, hang up/cancel.

- [ ] **Step 7: Integrate into app shell and chat header**

In `AuthenticatedAppLayout.tsx`, mount calls inside `RealtimeClientProvider`:

```tsx
<RealtimeClientProvider>
  <CallProvider>
    <RealtimeBridgeMount />
    <IncomingCallDialog />
    <CallOverlay />
    <Outlet />
  </CallProvider>
</RealtimeClientProvider>
```

In `ChatView.tsx`, add `ChatHeaderCallButtons` beside group member button:

```tsx
<ChatHeaderCallButtons conversation={conversation} disabled={disabled} />
```

- [ ] **Step 8: Add translations**

In `resources.ts`, add Chinese and English keys:

- `calls.actions.audio`
- `calls.actions.video`
- `calls.actions.accept`
- `calls.actions.reject`
- `calls.actions.hangUp`
- `calls.actions.cancel`
- `calls.actions.mute`
- `calls.actions.unmute`
- `calls.actions.cameraOff`
- `calls.actions.cameraOn`
- `calls.status.incomingAudio`
- `calls.status.incomingVideo`
- `calls.status.ringing`
- `calls.status.connecting`
- `calls.status.active`
- `calls.status.ended`
- `calls.errors.permissionDenied`
- `calls.errors.busy`
- `calls.errors.offline`
- `calls.errors.network`

- [ ] **Step 9: Verify GREEN**

Run:

```bash
cd web && pnpm lint
cd web && pnpm typecheck
cd web && pnpm test -- src/features/calls src/features/im/components/ChatView.test.tsx src/features/im/components/MessageList.test.tsx
cd web && pnpm build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add web/src/features/calls web/src/features/im/components/ChatView.tsx web/src/features/shell/AuthenticatedAppLayout.tsx web/src/shared/i18n/resources.ts
git commit -m "feat: add webrtc call ui"
```

---

### Task 10: End-to-End Verification, Docs, and Acceptance Checklist

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/deployment-webrtc.md`
- Modify: `web/README.md`
- Modify: `README.md` if a root README is added later; otherwise do not create one only for this task.

**Interfaces:**
- Produces: repeatable verification evidence and manual acceptance checklist.

- [ ] **Step 1: Run full backend verification**

Run:

```bash
cargo fmt --all --check
cargo test --lib
docker compose up -d postgres
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests
```

Expected: all commands exit 0.

- [ ] **Step 2: Run full frontend verification**

Run:

```bash
cd web && pnpm lint
cd web && pnpm typecheck
cd web && pnpm test
cd web && pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run deployment config verification**

Run:

```bash
docker compose config >/tmp/nano-chat-compose-rendered.yml
```

Expected: exits 0 and rendered config includes `caddy`, `app`, `postgres`, and `coturn` services.

- [ ] **Step 4: Update docs with verification commands**

In `docs/deployment-webrtc.md`, add a section:

```md
## Smoke test

1. Point DNS for NANO_CHAT_DOMAIN and TURN_PUBLIC_HOST at the VPS.
2. Open TCP 80/443/3478 and UDP 3478/49160-49200.
3. Run `docker compose --profile app up -d --build`.
4. Open `https://$NANO_CHAT_DOMAIN/healthz` and expect `200 OK`.
5. Log in from two browsers, create a direct conversation, and start an audio call.
6. Confirm `GET /api/v1/calls/ice-servers` returns one STUN server and one TURN server with temporary credentials.
```

In `web/README.md`, add local browser constraints:

```md
## WebRTC local notes

WebRTC media permission works on localhost during development. For LAN/mobile testing use HTTPS through Caddy or another trusted TLS endpoint. iOS Safari may block ringtone autoplay; the incoming call dialog remains the reliable indicator.
```

- [ ] **Step 5: Manual acceptance matrix**

Run these manually and record results in the PR or handoff:

```md
- [ ] Desktop Chrome caller to Desktop Chrome callee: audio call connects, mute works, hangup writes completed record.
- [ ] Desktop Chrome caller to Desktop Chrome callee: video call connects, camera toggle works.
- [ ] Desktop Chrome to iOS Safari over mobile network: call connects or uses TURN relay.
- [ ] Desktop Chrome to Android Chrome over mobile network: call connects or uses TURN relay.
- [ ] Callee offline: caller sees offline outcome and call record appears.
- [ ] Callee busy on another device: caller sees busy outcome and call record appears.
- [ ] Callee lets call ring past timeout: timeout record appears once.
- [ ] Callee rejects: rejected record appears once.
- [ ] Caller cancels before answer: canceled record appears once.
- [ ] Browser denies microphone/camera: no server call is created.
- [ ] Network interruption during active call: other side receives ended/network interruption state.
```

- [ ] **Step 6: Final commit**

If docs changed in this task:

```bash
git add docs/api.md docs/deployment-webrtc.md web/README.md
git commit -m "docs: document webrtc call verification"
```

If no docs changed because earlier tasks already included the exact content, skip the commit and state that no files changed.
