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

Conversation endpoints require authentication. Task 4 supports group lifecycle and membership only; direct conversations and messages are added later.

### List conversations

`GET /api/v1/conversations`

Returns active conversations for the authenticated user. The default list includes active groups even when they have no messages, excludes groups the user has left, and excludes dissolved groups.

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

`latest_message_seq` is `0` until the group has messages. `unread_count` is computed from `latest_message_seq - read_seq`.

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

Conversation error codes introduced here:

- `conversation_not_found`: requested conversation does not exist.
- `not_active_member`: caller is not an active member for an operation requiring active membership.
- `conversation_dissolved`: dissolved groups cannot be modified.
- `group_member_limit_exceeded`: group active member limit would exceed 500.
