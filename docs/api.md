# Nano Chat API

Base path for public HTTP APIs: `/api/v1`.

All request and response JSON uses `snake_case`. Authenticated endpoints require:

```http
Authorization: Bearer <access_token>
```

Access tokens are JWTs issued by Nano Chat and expire 7 days after registration or login.

## Auth

### Register

`POST /api/v1/auth/register`

Request:

```json
{
  "username": "alice",
  "password": "password123",
  "display_name": "Alice"
}
```

Rules:

- `username` is lowercased before storage and must be 3-32 characters using lowercase letters, digits, or `_`.
- `password` must be 8-128 characters.
- `display_name` is optional; when present it must be 1-80 characters.

Success: `201 Created`

```json
{
  "user": {
    "user_id": "018f0000-0000-7000-8000-000000000001",
    "username": "alice",
    "display_name": "Alice"
  },
  "client_id": "018f0000-0000-7000-8000-000000000002",
  "access_token": "<jwt>",
  "expires_at": "2026-06-20T00:00:00.000Z"
}
```

### Login

`POST /api/v1/auth/login`

Request:

```json
{
  "username": "alice",
  "password": "password123",
  "client_id": "018f0000-0000-7000-8000-000000000002"
}
```

`client_id` is optional. If omitted, the server creates a new client. If supplied, it must exist and belong to the authenticated user.

Success: `200 OK`, with the same response shape as register.

## Current User

### Get current user

`GET /api/v1/me`

Requires authentication.

Success: `200 OK`

```json
{
  "user_id": "018f0000-0000-7000-8000-000000000001",
  "username": "alice",
  "display_name": "Alice"
}
```

### Update current user

`PATCH /api/v1/me`

Requires authentication.

Request:

```json
{
  "display_name": "Alice A."
}
```

The `display_name` field is required. Set `display_name` to `null` to clear it; omitting the field is rejected as `invalid_request`.

Success: `200 OK`, returning the updated user summary.

## Users

### Exact username lookup

`GET /api/v1/users?username=alice`

Requires authentication. Performs exact username lookup; this is not a search endpoint.

Success: `200 OK`

```json
{
  "user_id": "018f0000-0000-7000-8000-000000000001",
  "username": "alice",
  "display_name": "Alice"
}
```

## Conversations

Conversation endpoints require authentication. Public HTTP supports conversation listing, group membership, and message history. Message sending is reserved for the WebSocket command layer; there is intentionally no public HTTP send-message endpoint.

### List conversations

`GET /api/v1/conversations`

Returns active conversations for the authenticated user. The default list includes active groups even when they have no messages, includes direct conversations only after their first message, excludes groups the user has left, and excludes dissolved groups.

Success: `200 OK`

```json
[
  {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "type": "group",
    "name": "project",
    "state": "active",
    "latest_message_seq": 0,
    "read_seq": 0,
    "unread_count": 0,
    "active_member_count": 2
  }
]
```

`latest_message_seq` is `0` until the conversation has messages. `unread_count` is computed from `latest_message_seq - read_seq`.

### Create group

`POST /api/v1/conversations/groups`

Request:

```json
{
  "name": "project",
  "member_ids": ["018f0000-0000-7000-8000-000000000002"]
}
```

Rules:

- `name` is trimmed and must be 1-80 characters.
- The creator is automatically a member.
- `member_ids` must include at least one unique user other than the creator.
- Duplicate member ids are ignored.
- A group can have at most 500 active members.
- Initial group members get an open visibility span starting at sequence `1` and `read_seq = 0`.

Success: `201 Created`, returning the conversation summary shape from the list endpoint.

### List active group members

`GET /api/v1/conversations/{conversation_id}/members`

Requires the caller to be an active member. Returns active members only.

Success: `200 OK`

```json
[
  {
    "user_id": "018f0000-0000-7000-8000-000000000001",
    "username": "alice",
    "display_name": "Alice"
  }
]
```

### Add or rejoin group member

`POST /api/v1/conversations/{conversation_id}/members`

Request:

```json
{
  "user_id": "018f0000-0000-7000-8000-000000000003"
}
```

Rules:

- Only active members can add members.
- Dissolved groups cannot be modified.
- Adding an already-active member is idempotent.
- First-time group joins create an open visibility span from sequence `1`.
- Rejoining creates a new open span from `last_message_seq + 1` and advances `read_seq` to the current `last_message_seq`.
- The 500 active member limit is enforced.

Success: `200 OK`, returning the added member summary.

### Leave group

`DELETE /api/v1/conversations/{conversation_id}/members/me`

Rules:

- The caller must be an active group member.
- Leaving closes the caller's open visibility span at the current `last_message_seq`.
- If the last active member leaves, the group state becomes `dissolved` and `dissolved_at` is set.
- Dissolved groups cannot be modified and are excluded from conversation lists.

Success: `204 No Content`.

## Messages

### List message history

`GET /api/v1/conversations/{conversation_id}/messages`

Query parameters:

- `after_seq`: optional. When present, returns messages with `message_seq > after_seq`.
- `before_seq`: optional. When present, returns messages with `message_seq < before_seq`.
- `limit`: optional, defaults to `50`, capped at `100`.

History responses are returned in ascending `message_seq` order. The caller must have a visibility span for the conversation. Former group members can read only messages inside their closed spans; messages sent after they left are filtered out.

Success: `200 OK`

```json
[
  {
    "message_id": "018f0000-0000-7000-8000-000000000020",
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "message_seq": 1,
    "sender": {
      "user_id": "018f0000-0000-7000-8000-000000000001",
      "username": "alice",
      "display_name": "Alice"
    },
    "body": "hello bob",
    "created_at": "2026-06-13T00:00:00.000Z"
  }
]
```

The `sender` object is the sender's current user summary at read time, not a message-time snapshot.

### Message sending semantics

Message sending is implemented for the WebSocket command layer and internal service callers only. Do not call HTTP to send messages.

Rules:

- `body` is stored as sent, but `body.trim()` must be non-empty.
- `body` is limited to 4096 UTF-8 bytes.
- `client_msg_id` is client-generated, must be 1-100 characters, and is recommended but not required to be a UUID.
- Idempotency scope is `(sender_user_id, client_id, client_msg_id)`.
- Reusing the same idempotency key with the same request returns the existing message and does not allocate a duplicate sequence.
- Reusing the same idempotency key with a different request returns `idempotency_conflict`.
- Sending to an existing conversation validates that the sender is a direct member or an active group member.
- Former group members cannot send to the group.
- Dissolved groups reject sends with `conversation_dissolved`.
- The sender's `read_seq` advances to the sent message sequence.

Direct sends target a user by username or user id. The first direct message creates the direct conversation, inserts both direct members, creates visibility spans from sequence `1`, allocates message sequence `1`, and commits all of that atomically. Later direct sends reuse the same direct conversation. Empty direct conversations are not exposed in conversation lists.

## WebSocket

Connect to `GET /ws?version=1`.

Authentication is required before upgrade. Browser clients may pass `token=<access_token>` in the query string. Non-browser clients may also use:

```http
Authorization: Bearer <access_token>
```

Unsupported or missing `version=1`, missing/invalid auth, and per-user connection-limit rejections return the normal HTTP error envelope before upgrade when practical.

### Client envelope

All client commands use a common snake_case JSON envelope. `id` is optional for heartbeat and recommended for commands where the client wants request/response correlation.

```json
{
  "id": "req-1",
  "type": "message.send",
  "payload": {}
}
```

Invalid JSON, non-text frames, unknown command types, invalid command payloads, and oversized WebSocket payloads are returned as a WebSocket `error` envelope and the connection is closed.

### Server envelopes

Success response:

```json
{
  "id": "req-1",
  "type": "message.send.ok",
  "payload": {}
}
```

Event:

```json
{
  "type": "message.created",
  "payload": {}
}
```

Error:

```json
{
  "id": "req-1",
  "type": "error",
  "error": {
    "code": "empty_message",
    "message": "Message body must not be empty"
  }
}
```

Business errors, such as `empty_message`, `conversation_dissolved`, or `idempotency_conflict`, return an `error` envelope without closing the connection.

### Commands

#### Send to an existing conversation

`message.send`

```json
{
  "id": "req-1",
  "type": "message.send",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "client_msg_id": "c1",
    "body": "hello"
  }
}
```

Success type: `message.send.ok`

The success payload is the same shape as `SendMessageResult`:

```json
{
  "conversation_id": "018f0000-0000-7000-8000-000000000010",
  "message": {
    "message_id": "018f0000-0000-7000-8000-000000000020",
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "message_seq": 1,
    "sender": {
      "user_id": "018f0000-0000-7000-8000-000000000001",
      "username": "alice",
      "display_name": "Alice"
    },
    "body": "hello",
    "created_at": "2026-06-13T00:00:00.000Z"
  }
}
```

#### Send or create a direct conversation

`direct_message.send`

Specify exactly one of `target_username` or `target_user_id`.

```json
{
  "id": "req-2",
  "type": "direct_message.send",
  "payload": {
    "target_username": "bob",
    "client_msg_id": "d1",
    "body": "hello bob"
  }
}
```

Success type: `direct_message.send.ok`; payload shape is the same as `message.send.ok`.

#### Mark a conversation read

`conversation.read`

```json
{
  "id": "req-3",
  "type": "conversation.read",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "read_seq": 12
  }
}
```

`read_seq` is monotonic and is capped at the conversation's current latest message sequence.

Success:

```json
{
  "id": "req-3",
  "type": "conversation.read.ok",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "read_seq": 12
  }
}
```

#### Heartbeat

`heartbeat.ping`

```json
{
  "type": "heartbeat.ping",
  "payload": {
    "client_time": "2026-06-13T00:00:00Z"
  }
}
```

Success type: `heartbeat.pong`.

```json
{
  "type": "heartbeat.pong",
  "payload": {
    "server_time": "2026-06-13T00:00:00.000Z"
  }
}
```

Recommended client heartbeat interval is the configured server interval, default `30` seconds. Connections that do not send any valid envelope for the idle timeout, default `90` seconds, are removed from the local registry and closed.

### Realtime event fan-out

After successful state changes, the server fans out WebSocket events locally and publishes a small JSON payload on Postgres `LISTEN/NOTIFY` so other Nano Chat instances can fan out to their own local registries. The channel is configured by `NANO_CHAT_NOTIFY_CHANNEL` and defaults to `nano_chat_events`.

Realtime notifications are best-effort and at-most-once. They are not the source of truth: message history and conversation sync APIs remain authoritative. Clients should track the highest contiguous `message_seq` seen per conversation. If a `message.created` event reveals a sequence gap, reconnects occur, or the client suspects missed events, recover by calling `GET /api/v1/conversations/{conversation_id}/messages?after_seq=<last_contiguous_seq>`.

`message.created` is emitted only for newly inserted messages. Idempotent retries that return an existing message do not emit another event. Recipients are users whose visibility spans include the created `message_seq`, so former group members do not receive messages sent after they left.

```json
{
  "type": "message.created",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "message": {
      "message_id": "018f0000-0000-7000-8000-000000000020",
      "conversation_id": "018f0000-0000-7000-8000-000000000010",
      "message_seq": 12,
      "sender": {
        "user_id": "018f0000-0000-7000-8000-000000000001",
        "username": "alice",
        "display_name": "Alice"
      },
      "body": "hello",
      "created_at": "2026-06-13T00:00:00.000Z"
    }
  }
}
```

Other events use the same server envelope shape:

```json
{
  "type": "conversation.read_updated",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "user_id": "018f0000-0000-7000-8000-000000000001",
    "read_seq": 12
  }
}
```

```json
{
  "type": "conversation.member_added",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "member": {
      "user_id": "018f0000-0000-7000-8000-000000000003",
      "username": "carol",
      "display_name": "Carol"
    }
  }
}
```

```json
{
  "type": "conversation.member_left",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "user_id": "018f0000-0000-7000-8000-000000000003"
  }
}
```

```json
{
  "type": "conversation.dissolved",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "user_id": "018f0000-0000-7000-8000-000000000001"
  }
}
```

The origin WebSocket connection receives only its command response, such as `message.send.ok`, `direct_message.send.ok`, or `conversation.read.ok`; it does not receive a duplicate event for that same command. Other connections owned by the same user can receive the event. HTTP-originated membership events do not have an origin WebSocket connection to skip. `conversation.dissolved` is sent only to the final leaving user's remaining connections, not to other historical members. Fan-out uses bounded per-connection queues; recipients whose local queue is full or closed are skipped.

Postgres NOTIFY payloads include `origin_instance_id`, optional `origin_connection_id`, and the event, and are rejected by the server if the serialized payload is 8000 bytes or larger. The receiving instance uses the same visibility rules as local delivery and ignores notifications published by its own `origin_instance_id` to avoid duplicates. Cross-instance fan-out does not require sticky sessions.

## Error Format

Errors use stable machine-readable codes. Request parsing errors (for example malformed JSON, non-JSON request content, invalid query parameters, or invalid path IDs such as malformed `conversation_id` UUIDs) use this same envelope.

```json
{
  "error": {
    "code": "invalid_token",
    "message": "Missing or invalid bearer token"
  }
}
```

Auth/user error codes introduced here:

- `invalid_request`: request validation failed.
- `invalid_credentials`: username/password login failed.
- `username_taken`: registration username already exists.
- `invalid_token`: bearer token is missing, malformed, expired, or no longer maps to a user/client.
- `client_not_found`: supplied login `client_id` does not exist.
- `client_owner_mismatch`: supplied login `client_id` belongs to another user.
- `user_not_found`: requested user does not exist.

Conversation and message error codes introduced here:

- `conversation_not_found`: requested conversation does not exist.
- `message_not_found`: requested message does not exist.
- `not_conversation_member`: caller has no membership/visibility for the conversation.
- `not_active_member`: caller is not an active member for an operation requiring active membership.
- `conversation_dissolved`: dissolved groups cannot be modified or receive messages.
- `group_member_limit_exceeded`: group active member limit would exceed 500.
- `empty_message`: message body is empty after trimming whitespace.
- `message_too_large`: message body exceeds the configured maximum, currently 4096 bytes.
- `idempotency_conflict`: `client_msg_id` was reused for a different message request.

WebSocket error codes introduced here:

- `too_many_connections`: user exceeded the configured local WebSocket connection limit.
- `unsupported_ws_version`: `/ws` version is missing or unsupported.
- `invalid_ws_envelope`: WebSocket JSON envelope or command payload is invalid.
- `ws_payload_too_large`: WebSocket frame exceeds the configured maximum payload size.
- `heartbeat_timeout`: connection exceeded the heartbeat idle timeout.
