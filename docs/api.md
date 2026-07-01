# Nano Chat API

Base path for public HTTP APIs: `/api/v1`.

In production, the same Nano Chat Rust service serves the Web SPA static build from `WEB_DIST_DIR` alongside `/api/v1`, `/ws`, `/healthz`, and `/readyz`. Non-backend browser routes fall back to `index.html`; backend routes are not handled by the SPA fallback.

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
    "user_id": "1001",
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

## Users and `/me`

### Get current user

`GET /api/v1/me`

Requires authentication.

Success: `200 OK`

```json
{
  "user_id": "1001",
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
  "user_id": "1001",
  "username": "alice",
  "display_name": "Alice"
}
```

## Conversations

Conversation endpoints require authentication. Public HTTP supports conversation listing, group membership, and message history. Message sending is reserved for the WebSocket command layer; there is intentionally no public HTTP send-message endpoint.

### List conversations

`GET /api/v1/conversations`

Returns active conversations for the authenticated user. The default list includes active groups even when they have no messages, includes direct conversations only after their first message, excludes groups the user has left, and excludes dissolved groups. Conversations with visible messages are ordered by the latest visible message timestamp.

Success: `200 OK`

```json
[
  {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "type": "group",
    "name": "project",
    "state": "active",
    "latest_message_seq": 12,
    "read_seq": 10,
    "unread_count": 2,
    "active_member_count": 2,
    "direct_user": null,
    "latest_message": {
      "message_id": "018f0000-0000-7000-8000-000000000020",
      "message_seq": 12,
      "sender": {
        "user_id": "1001",
        "username": "alice",
        "display_name": "Alice"
      },
      "body": "hello",
      "message_type": "text",
      "metadata": {},
      "created_at": "2026-06-13T00:00:00.000Z"
    }
  },
  {
    "conversation_id": "018f0000-0000-7000-8000-000000000011",
    "type": "direct",
    "name": null,
    "state": "active",
    "latest_message_seq": 1,
    "read_seq": 1,
    "unread_count": 0,
    "active_member_count": 2,
    "direct_user": {
      "user_id": "1002",
      "username": "bob",
      "display_name": "Bob"
    },
    "latest_message": {
      "message_id": "018f0000-0000-7000-8000-000000000021",
      "message_seq": 1,
      "sender": {
        "user_id": "1002",
        "username": "bob",
        "display_name": "Bob"
      },
      "body": "hi alice",
      "message_type": "text",
      "metadata": {},
      "created_at": "2026-06-13T00:01:00.000Z"
    }
  }
]
```

`direct_user` is the other participant for direct conversations and `null` for groups. `latest_message` is the latest message visible to the authenticated user according to visibility spans; it is `null` when no message is visible to that user. `latest_message_seq` is `0` until the conversation has messages. `unread_count` is computed from `latest_message_seq - read_seq`.

### Create group

`POST /api/v1/conversations/groups`

Request:

```json
{
  "name": "project",
  "member_ids": ["1002"]
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

## Group Members

Group membership endpoints require authentication and apply to group conversations only.

### List active group members

`GET /api/v1/conversations/{conversation_id}/members`

Requires the caller to be an active member. Returns active members only.

Success: `200 OK`

```json
[
  {
    "user_id": "1001",
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
  "user_id": "1003"
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

## Message History

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
      "user_id": "1001",
      "username": "alice",
      "display_name": "Alice"
    },
    "body": "hello bob",
    "message_type": "text",
    "metadata": {},
    "created_at": "2026-06-13T00:00:00.000Z"
  }
]
```

Call event messages use `message_type: "call_event"` and include call details in `metadata`, for example:

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

Call record `metadata.outcome` values:

| Outcome | Meaning |
| --- | --- |
| `completed` | Call completed normally. |
| `rejected` | Callee rejected before connecting. |
| `canceled` | Caller canceled before connecting. |
| `timeout` | Ringing timed out. |
| `busy` | Callee was busy. |
| `offline` | Callee was offline. |
| `network_error` | Call ended due to network interruption. |

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

## Calls HTTP

### ICE servers

`GET /api/v1/calls/ice-servers`

Requires authentication. Returns STUN/TURN ICE server configuration for WebRTC clients. TURN credentials are generated per authenticated user/client using coturn shared-secret authentication and are short-lived; clients must refresh before `expires_at`.

Success: `200 OK`

```json
{
  "ice_servers": [
    {"urls": ["stun:turn.example.com:3478"]},
    {
      "urls": ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
      "username": "1782864600:1001:018f0000-0000-7000-8000-000000000002",
      "credential": "<hmac-sha1-base64>"
    }
  ],
  "expires_at": "2026-07-01T00:10:00.000Z"
}
```

## WebSocket Envelope

Connect to `GET /ws?version=1`.

Authentication is required before upgrade. Browser clients may pass `token=<access_token>` in the query string. Non-browser clients may also use:

```http
Authorization: Bearer <access_token>
```

Unsupported or missing `version=1`, missing/invalid auth, and per-user connection-limit rejections return the normal HTTP error envelope before upgrade when practical.

### Client command envelope

All client commands use a common snake_case JSON envelope. `id` is optional for heartbeat and recommended for commands where the client wants request/response correlation.

```json
{
  "id": "req-1",
  "type": "message.send",
  "payload": {}
}
```

Invalid JSON, non-text frames, unknown command types, invalid command payloads, and oversized WebSocket payloads are returned as a WebSocket `error` envelope and the connection is closed.

### Server response and event envelopes

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
      "user_id": "1001",
      "username": "alice",
      "display_name": "Alice"
    },
    "body": "hello",
    "message_type": "text",
    "metadata": {},
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

`read_seq` is monotonic. Values outside the caller's visible message range are rejected with `invalid_request` instead of being capped.

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

#### 1v1 call invite

`call.invite` starts a WebRTC call in an active direct conversation. All online callee clients receive `call.incoming`; the first callee client to accept wins.

Deployment cleanup behavior:

- Ringing calls time out after `NANO_CHAT_CALL_RINGING_TIMEOUT_SECS` seconds, default `60`, and end with `end_reason: "timeout"`.
- Connecting or active calls get a disconnect grace window of `NANO_CHAT_CALL_DISCONNECT_GRACE_SECS` seconds, default `15`, when a selected caller or accepted callee client disappears from the local registry. If the selected clients are visible again before the grace window elapses, the interruption marker is cleared; otherwise the call ends with `end_reason: "network_error"`.
- Cleanup runs every `NANO_CHAT_CALL_CLEANUP_INTERVAL_SECS` seconds, default `5`. On service startup, any non-ended calls left by a previous process are ended as `network_error` before the server starts accepting traffic.

```json
{
  "id": "call-1",
  "type": "call.invite",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000011",
    "media_type": "video"
  }
}
```

Success type: `call.invite.ok`.

```json
{
  "id": "call-1",
  "type": "call.invite.ok",
  "payload": {
    "call": {
      "call_id": "018f0000-0000-7000-8000-000000000040",
      "conversation_id": "018f0000-0000-7000-8000-000000000011",
      "caller": {"user_id": "1001", "username": "alice", "display_name": "Alice"},
      "callee": {"user_id": "1002", "username": "bob", "display_name": "Bob"},
      "caller_client_id": "018f0000-0000-7000-8000-000000000002",
      "accepted_client_id": null,
      "media_type": "video",
      "state": "ringing",
      "started_at": "2026-06-13T00:00:00.000Z",
      "accepted_at": null,
      "ended_at": null,
      "end_reason": null
    }
  }
}
```

Incoming event:

```json
{
  "type": "call.incoming",
  "payload": {
    "call": {
      "call_id": "018f0000-0000-7000-8000-000000000040",
      "conversation_id": "018f0000-0000-7000-8000-000000000011",
      "caller": {"user_id": "1001", "username": "alice", "display_name": "Alice"},
      "callee": {"user_id": "1002", "username": "bob", "display_name": "Bob"},
      "caller_client_id": "018f0000-0000-7000-8000-000000000002",
      "accepted_client_id": null,
      "media_type": "video",
      "state": "ringing",
      "started_at": "2026-06-13T00:00:00.000Z",
      "accepted_at": null,
      "ended_at": null,
      "end_reason": null
    }
  }
}
```

#### 1v1 call accept

`call.accept` may be sent by one callee client while the call is ringing. Other callee clients receive `call.accepted` and should stop ringing.

```json
{
  "id": "accept-1",
  "type": "call.accept",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040"
  }
}
```

Success type: `call.accept.ok`.

Accepted event:

```json
{
  "type": "call.accepted",
  "payload": {
    "call": {
      "call_id": "018f0000-0000-7000-8000-000000000040",
      "conversation_id": "018f0000-0000-7000-8000-000000000011",
      "caller": {"user_id": "1001", "username": "alice", "display_name": "Alice"},
      "callee": {"user_id": "1002", "username": "bob", "display_name": "Bob"},
      "caller_client_id": "018f0000-0000-7000-8000-000000000002",
      "accepted_client_id": "018f0000-0000-7000-8000-000000000003",
      "media_type": "video",
      "state": "connecting",
      "started_at": "2026-06-13T00:00:00.000Z",
      "accepted_at": "2026-06-13T00:00:03.000Z",
      "ended_at": null,
      "end_reason": null
    }
  }
}
```

#### 1v1 call connected

`call.connected` marks the accepted call as active after media is established.

```json
{
  "id": "connected-1",
  "type": "call.connected",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040"
  }
}
```

Success type: `call.connected.ok`.

Connected event:

```json
{
  "type": "call.connected",
  "payload": {
    "call": {
      "call_id": "018f0000-0000-7000-8000-000000000040",
      "conversation_id": "018f0000-0000-7000-8000-000000000011",
      "caller": {"user_id": "1001", "username": "alice", "display_name": "Alice"},
      "callee": {"user_id": "1002", "username": "bob", "display_name": "Bob"},
      "caller_client_id": "018f0000-0000-7000-8000-000000000002",
      "accepted_client_id": "018f0000-0000-7000-8000-000000000003",
      "media_type": "video",
      "state": "active",
      "started_at": "2026-06-13T00:00:00.000Z",
      "accepted_at": "2026-06-13T00:00:03.000Z",
      "ended_at": null,
      "end_reason": null
    }
  }
}
```

#### 1v1 call hangup

`call.hangup` ends a connecting or active call. `reason` is optional and defaults to `completed`; when supplied it must be `completed` or `network_error`.

```json
{
  "id": "hangup-1",
  "type": "call.hangup",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "reason": "completed"
  }
}
```

Success type: `call.hangup.ok`.

Ended event:

```json
{
  "type": "call.ended",
  "payload": {
    "call": {
      "call_id": "018f0000-0000-7000-8000-000000000040",
      "conversation_id": "018f0000-0000-7000-8000-000000000011",
      "caller": {"user_id": "1001", "username": "alice", "display_name": "Alice"},
      "callee": {"user_id": "1002", "username": "bob", "display_name": "Bob"},
      "caller_client_id": "018f0000-0000-7000-8000-000000000002",
      "accepted_client_id": "018f0000-0000-7000-8000-000000000003",
      "media_type": "video",
      "state": "ended",
      "started_at": "2026-06-13T00:00:00.000Z",
      "accepted_at": "2026-06-13T00:00:03.000Z",
      "ended_at": "2026-06-13T00:03:15.000Z",
      "end_reason": "completed"
    }
  }
}
```

`call.reject` and `call.cancel` use the same `{ "call_id": "..." }` payload shape and return `call.reject.ok` or `call.cancel.ok`; their state events are `call.rejected` and `call.canceled`.

#### 1v1 call signal

`call.signal` sends WebRTC SDP/ICE data directly to the accepted peer client only. Signal payloads are not published through Postgres `NOTIFY`.

Offer:

```json
{
  "id": "signal-offer-1",
  "type": "call.signal",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "signal_type": "offer",
    "data": {"type": "offer", "sdp": "v=0"}
  }
}
```

Answer:

```json
{
  "id": "signal-answer-1",
  "type": "call.signal",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "signal_type": "answer",
    "data": {"type": "answer", "sdp": "v=0"}
  }
}
```

ICE candidate:

```json
{
  "id": "signal-ice-1",
  "type": "call.signal",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "signal_type": "ice_candidate",
    "data": {"candidate": "candidate:0 1 UDP 2122252543 192.0.2.1 54400 typ host"}
  }
}
```

Success type: `call.signal.ok`.

Signal event delivered to the peer client:

```json
{
  "type": "call.signal",
  "payload": {
    "call_id": "018f0000-0000-7000-8000-000000000040",
    "signal_type": "offer",
    "data": {"type": "offer", "sdp": "v=0"}
  }
}
```

### Events and realtime fan-out

After successful state changes, the server fans out WebSocket events locally and publishes a small JSON payload on Postgres `LISTEN/NOTIFY` so other Nano Chat instances can fan out to their own local registries. The channel is configured by `NANO_CHAT_NOTIFY_CHANNEL` and defaults to `nano_chat_events`.

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
        "user_id": "1001",
        "username": "alice",
        "display_name": "Alice"
      },
      "body": "hello",
      "message_type": "text",
      "metadata": {},
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
    "user_id": "1001",
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
      "user_id": "1003",
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
    "user_id": "1003"
  }
}
```

```json
{
  "type": "conversation.dissolved",
  "payload": {
    "conversation_id": "018f0000-0000-7000-8000-000000000010",
    "user_id": "1001"
  }
}
```

The origin WebSocket connection receives only its command response, such as `message.send.ok`, `direct_message.send.ok`, or `conversation.read.ok`; it does not receive a duplicate event for that same command. Other connections owned by the same user can receive the event. HTTP-originated membership events do not have an origin WebSocket connection to skip. `conversation.dissolved` is sent only to the final leaving user's remaining connections, not to other historical members. Fan-out uses bounded per-connection queues; recipients whose local queue is full or closed are skipped.

Postgres NOTIFY payloads include `origin_instance_id`, optional `origin_connection_id`, and the event, and are rejected by the server if the serialized payload is 8000 bytes or larger. The receiving instance uses the same visibility rules as local delivery and ignores notifications published by its own `origin_instance_id` to avoid duplicates. Cross-instance fan-out does not require sticky sessions.

### Sync and reconnect behavior

Realtime notifications are best-effort and at-most-once. They are not the source of truth: message history and conversation sync APIs remain authoritative. Clients should track the highest contiguous `message_seq` seen per conversation. If a `message.created` event reveals a sequence gap, reconnects occur, or the client suspects missed events, recover by calling `GET /api/v1/conversations/{conversation_id}/messages?after_seq=<last_contiguous_seq>`.

## Errors

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

## Deployment and Configuration Notes

Nano Chat expects schema migrations to be run explicitly before the application starts. Application startup does not run migrations automatically.

For local Compose Postgres used by integration tests:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests -- --nocapture
```

For local Web development, start the Rust backend on `127.0.0.1:3000`, then run `pnpm dev` from `web/`. The Vite dev server proxies `/api/v1` HTTP requests and `/ws` WebSocket upgrades to the Rust backend, so browser code can keep the default same-origin `VITE_API_BASE_URL=/api/v1` and derived `VITE_WS_URL=/ws?version=1` behavior. Override `VITE_API_BASE_URL` or `VITE_WS_URL` only when the browser must call a different API or WebSocket origin.

Production builds use `pnpm build` to create `web/dist`. The Rust service serves that directory from `WEB_DIST_DIR` (Docker images set `WEB_DIST_DIR=/app/web/dist`) alongside `/api/v1`, `/ws`, `/healthz`, and `/readyz`; non-backend Web routes fall back to `index.html`.

The Compose Postgres image defaults to `mirror.gcr.io/library/postgres:17` for environments where Docker Hub pulls are unreliable. Operators can use the official Docker Hub image by setting `POSTGRES_IMAGE=postgres:17`.

For an application deployment, see also `docs/deployment-webrtc.md` for the single-VPS Caddy and coturn firewall checklist:

1. Copy `.env.example` to `.env`, replace `JWT_SECRET` and `TURN_SHARED_SECRET` with strong secrets of at least 32 characters, set `NANO_CHAT_DOMAIN` to the HTTPS app host, set `TURN_PUBLIC_HOST` and `TURN_REALM` to the TURN host, and set `NANO_CHAT_IMAGE` if you want Compose to run a prebuilt image instead of `nano-chat:local`.
2. Start Postgres: `docker compose up -d postgres`.
3. Run migrations from the host or CI against the target database before starting the app, for example:

   ```bash
   DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test sqlx migrate run
   ```

   If you changed `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, or `POSTGRES_PORT`, update this host-side URL to match.

4. Open inbound TCP 80 and 443, UDP/TCP 3478, and UDP 49160-49200 on the VPS firewall, then start the app, Caddy, and coturn: `docker compose --profile app up -d --build`.

The app container derives its default `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` so it can reach the Compose Postgres service by service name. Leave `DATABASE_URL` unset/commented to use that derived default, or set it explicitly when connecting to a different database. If set explicitly, it must match the Postgres credentials and database name you intend the app to use. Host-side tools generally use `localhost` and the published Postgres port instead. The app service exposes port 3000 only inside the Docker network; Caddy publishes HTTPS on host ports 80 and 443.

Configuration variables:

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `POSTGRES_IMAGE` | `mirror.gcr.io/library/postgres:17` | Compose Postgres image. Set to `postgres:17` to pull from Docker Hub. |
| `POSTGRES_USER` | `nano` | Official Postgres image user. |
| `POSTGRES_PASSWORD` | `nano` | Official Postgres image password. |
| `POSTGRES_DB` | `nano_chat_test` | Official Postgres image database name. |
| `POSTGRES_PORT` | `5432` | Host port published by Compose Postgres. |
| `APP_PORT` | `3000` | Legacy local app port setting; the single-VPS app profile is reached through Caddy instead of publishing the app port directly. |
| `NANO_CHAT_IMAGE` | `nano-chat:local` | Compose image name for the optional app service. |
| `NANO_CHAT_DOMAIN` | `chat.example.com` | HTTPS host served by Caddy for the app. |
| `DATABASE_URL` | Derived from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` | Application database URL; may be set explicitly and should match the Postgres settings. |
| `JWT_SECRET` | `change-me-development-secret-at-least-32-bytes` | JWT signing secret; must be changed outside local development. |
| `BIND_ADDR` | `0.0.0.0:3000` | Address the HTTP/WebSocket server binds to. |
| `RUST_LOG` | `nano_chat=debug,tower_http=info` | Tracing filter. |
| `WEB_DIST_DIR` | `web/dist` | Directory containing the built Web SPA assets. Docker images set this to `/app/web/dist`. |
| `NANO_CHAT_NOTIFY_CHANNEL` | `nano_chat_events` | Postgres `LISTEN/NOTIFY` channel for cross-instance fan-out. |
| `NANO_CHAT_MAX_CONNECTIONS_PER_USER` | `10` | Per-instance WebSocket connection limit per user. |
| `NANO_CHAT_HEARTBEAT_INTERVAL_SECS` | `30` | Recommended heartbeat interval for clients. |
| `NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS` | `90` | Idle timeout before a WebSocket is closed. |
| `NANO_CHAT_MAX_WS_PAYLOAD_BYTES` | `65536` | Maximum inbound WebSocket frame payload size. |
| `NANO_CHAT_MAX_MESSAGE_BYTES` | `4096` | Maximum message body size in UTF-8 bytes. |
| `TURN_PUBLIC_HOST` | `turn.example.com` | Public TURN host used for local defaults and deployment alignment. |
| `TURN_REALM` | `turn.example.com` | TURN realm configured in coturn. |
| `TURN_SHARED_SECRET` | `change-me-turn-shared-secret-at-least-32-bytes` | Coturn shared-secret key for generating short-lived TURN credentials; must be at least 32 characters. |
| `TURN_CREDENTIAL_TTL_SECS` | `600` | Lifetime for generated TURN credentials. |
| `TURN_STUN_URL` | `stun:turn.example.com:3478` | STUN URL returned by `GET /api/v1/calls/ice-servers`. |
| `TURN_UDP_URL` | `turn:turn.example.com:3478?transport=udp` | TURN UDP URL returned by `GET /api/v1/calls/ice-servers`. |
| `TURN_TCP_URL` | `turn:turn.example.com:3478?transport=tcp` | TURN TCP URL returned by `GET /api/v1/calls/ice-servers`. |
| `TURN_RELAY_MIN_PORT` | `49160` | Lower bound of the UDP TURN relay port range opened on the VPS. |
| `TURN_RELAY_MAX_PORT` | `49200` | Upper bound of the UDP TURN relay port range opened on the VPS. |
