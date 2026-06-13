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

## Error Format

Errors use stable machine-readable codes. Request parsing errors (for example malformed JSON, non-JSON request content, or invalid query parameters) use this same envelope.

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
