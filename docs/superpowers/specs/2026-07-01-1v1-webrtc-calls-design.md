# 1v1 WebRTC Calls Design

## Summary

Nano Chat will add one-to-one audio and video calls that are started from an existing direct conversation. The browser handles media using WebRTC. The Rust service coordinates call state, authorization, busy handling, signaling, and call record messages. A single-VPS Docker Compose deployment will include Caddy for HTTPS and coturn for reliable TURN relay.

## Goals

- Let a user start an audio or video call from a direct conversation.
- Ring all online clients for the callee; the first accepted client owns the call and the other ringing clients stop.
- Support answer, reject, cancel, hang up, mute microphone, toggle camera, ringtone, busy state, call timeout, and network interruption notices.
- Support desktop Chrome/Edge/Safari and mobile iOS Safari/Android Chrome.
- Provide reliable public-network connectivity through coturn with short-lived TURN credentials.
- Write a simple call record message into the direct conversation with detailed outcomes such as completed, rejected, busy, timed out, canceled, or network interrupted.

## Non-goals

- Group calls.
- Screen sharing.
- Recording calls.
- Server-side media inspection, transcoding, or storage.
- SFU/media-server integration.
- Detailed call analytics beyond the call record message.

## Domain Language

The root `CONTEXT.md` defines these call terms:

- **通话**: a realtime one-to-one audio or video interaction started from a direct conversation.
- **来电**: a pending call waiting for the invited user to answer, reject, or miss it.
- **忙线**: a user cannot receive or start another call because that user already has a pending or active call.
- **通话记录消息**: a conversation message that records the visible outcome of a call.

Additional implementation-facing terms:

- **Signaling**: WebRTC offer, answer, and ICE candidate payloads exchanged over Nano Chat WebSocket events. Signaling is transient and is not stored as message history.
- **Media stream**: microphone/camera data exchanged browser-to-browser through WebRTC, with TURN relay when direct connectivity fails. Nano Chat backend does not receive media stream contents.

## Recommended Approach

Use server-managed call sessions plus browser WebRTC P2P media.

Rejected alternatives:

1. **Pure in-memory signaling only**: faster, but weak under refresh, restart, timeout, and future multi-instance scenarios.
2. **SFU/media server**: powerful but too heavy for first 1v1 calls and unnecessary for current requirements.

The server-managed call session approach gives a durable source of truth for call state, busy locking, authorization, timeout cleanup, and call record messages while keeping media transfer out of Nano Chat.

## Backend Architecture

Add a `calls` module with a small external interface:

- start a call from a direct conversation
- accept, reject, cancel, and hang up a call
- relay WebRTC signaling for an active call
- issue short-lived ICE server credentials
- run timeout/disconnect cleanup

The implementation owns call state transitions, membership checks, busy locking, call record creation, and realtime fanout.

### Database Model

Add `call_sessions`:

- `call_id uuid primary key`
- `conversation_id uuid not null references conversations`
- `caller_user_id bigint not null references users`
- `callee_user_id bigint not null references users`
- `media_type text not null check in ('audio', 'video')`
- `state text not null check in ('ringing', 'connecting', 'active', 'ended')`
- `started_at timestamptz not null`
- `accepted_at timestamptz`
- `ended_at timestamptz`
- `end_reason text check in ('completed', 'rejected', 'canceled', 'timeout', 'busy', 'offline', 'network_error')`
- `caller_client_id uuid not null references clients`
- `accepted_client_id uuid null references clients`
- `created_message_id uuid null references messages`

Add `call_participants`:

- `call_id uuid not null references call_sessions`
- `user_id bigint not null references users`
- `role text not null check in ('caller', 'callee')`
- `state text not null check in ('ringing', 'connecting', 'active', 'ended')`
- primary key `(call_id, user_id)`

Use a partial unique index for the global single-call busy rule:

- unique user participation where participant state is `ringing`, `connecting`, or `active`.

Extend `messages`:

- `message_type text not null default 'text' check in ('text', 'call_event')`
- `metadata jsonb not null default '{}'::jsonb`

For compatibility, keep `body` as a display fallback. Existing text messages remain valid. A call event message stores structured metadata such as `call_id`, `media_type`, `outcome`, `duration_seconds`, `caller_user_id`, and `callee_user_id`.

### WebSocket Commands

Add client commands:

- `call.invite`
  - payload: `conversation_id`, `media_type`
  - validates direct conversation membership, callee online status, and busy state
- `call.accept`
  - payload: `call_id`
  - moves call to `connecting`, stores accepting client, stops ringing on other callee clients
- `call.connected`
  - payload: `call_id`
  - sent after WebRTC reaches a connected state; moves the call from `connecting` to `active` idempotently
- `call.reject`
  - payload: `call_id`
  - ends call as `rejected`
- `call.cancel`
  - payload: `call_id`
  - caller cancels before accept
- `call.hangup`
  - payload: `call_id`, optional `reason`
  - ends active/connecting call as `completed` or `network_error`
- `call.signal`
  - payload: `call_id`, `signal_type` (`offer`, `answer`, `ice_candidate`), `data`
  - relays only between the two users participating in that call

### WebSocket Events

Add server events:

- `call.incoming`
- `call.ringing`
- `call.accepted`
- `call.connected`
- `call.rejected`
- `call.canceled`
- `call.ended`
- `call.busy`
- `call.signal`

The event payloads include `call_id`, `conversation_id`, caller/callee summaries where needed, `media_type`, state, timestamps, and end reason where applicable.

### Authorization and State Rules

- Calls can only start from active direct conversations.
- The caller and callee must be the two members of the direct conversation.
- A user can be in only one non-ended call globally across all clients.
- `call.signal` can only be sent by a participant in the matching call.
- `call.invite` stores the originating caller client. Once one callee client accepts, `call.accept` stores that accepted callee client and all other callee clients receive an event to stop ringing.
- Signaling is routed only between the originating caller client and the accepted callee client. Broader call state events may still be sent to all online clients for those two users so their UI can converge.
- End transitions are idempotent: duplicate hangup/reject/cancel commands return the final state rather than creating duplicate call records.

### Call Record Messages

When a call reaches a final state, the server writes one `call_event` message into the direct conversation and publishes the normal `message.created` realtime event.

Outcomes to display:

- completed audio/video call with duration
- caller canceled before answer
- callee rejected
- callee offline
- callee busy
- timed out with no answer
- network interrupted

## Frontend Architecture

Add a call feature area under the web app with these modules:

- `CallProvider` / `useCall()`: global call state interface for UI modules.
- `CallEngine`: owns `RTCPeerConnection`, local stream, remote stream, ICE handling, media permissions, and cleanup.
- `IncomingCallDialog`: global incoming-call prompt and ringtone handling.
- `CallOverlay`: desktop floating/full overlay and mobile full-screen call UI.
- `ChatHeaderCallButtons`: audio and video call buttons shown only in direct conversations.

`ChatView` should not own WebRTC details. It only renders call buttons for direct conversations and delegates actions to `useCall()`.

### User Flow

Caller:

1. Opens a direct conversation.
2. Clicks audio or video call.
3. Browser requests microphone and, for video calls, camera permission.
4. Frontend sends `call.invite`.
5. Caller sees ringing state.
6. After callee accepts, WebRTC signaling begins.
7. User can mute, toggle camera, or hang up.

Callee:

1. All online clients receive `call.incoming`.
2. A global dialog appears with ringtone when allowed by the browser.
3. User accepts, rejects, or lets it time out.
4. If another client accepts, this client stops ringing.

### Browser and Mobile Constraints

- Production must use HTTPS/WSS for media permission outside localhost.
- iOS Safari may block autoplay ringtone; the visual incoming-call prompt remains authoritative.
- Mobile call UI should be full screen in the first version to avoid layout issues with the chat shell.
- Camera and microphone permission denial stops call creation and shows a local permission error; it should not create a server call session.

## Deployment Architecture

Single VPS Docker Compose will include:

- `caddy`: public 80/443, automatic HTTPS, reverse proxy to app.
- `app`: Nano Chat Rust service and web assets, private Docker network port 3000.
- `postgres`: existing database.
- `coturn`: public TURN/STUN server.

Recommended coturn exposure:

- `3478/udp`
- `3478/tcp`
- relay UDP range such as `49160-49200/udp` initially, expanded for higher concurrency.

### TURN Authentication

Use coturn `use-auth-secret` with a shared secret.

Configuration:

- `.env`: `TURN_REALM`, `TURN_PUBLIC_HOST`, `TURN_SHARED_SECRET`, relay port range.
- backend config reads the shared secret and TURN URLs.
- authenticated endpoint: `GET /api/v1/calls/ice-servers`.

The backend generates short-lived TURN credentials, for example 10 minutes:

- username: expiry timestamp plus user id/client id context
- password: HMAC over username using `TURN_SHARED_SECRET`

The browser receives STUN/TURN URLs plus temporary credentials. Static TURN credentials are not embedded in frontend code.

## Error Handling

- **Callee offline**: `call.invite` returns or emits `callee_offline`; server writes an offline call record.
- **Busy**: if the callee is busy, invite fails with `busy` and the server writes a busy call record. If the caller is already busy, invite fails locally/server-side without creating a second call record.
- **Timeout**: server ends `ringing` calls after configured timeout and writes a timeout record.
- **Permission denied**: frontend shows a local error before creating a server call.
- **WebRTC connection failure**: frontend sends `call.hangup` with `network_error`; server writes a network interruption record.
- **WebSocket disconnect/page refresh during call**: server gives a short grace period, then ends the call if the participant does not return.
- **Server restart**: startup cleanup marks non-ended calls as interrupted and releases busy locks.

## Testing Strategy

Backend tests:

- direct-conversation-only call start validation
- caller/callee membership and authorization
- concurrent busy lock enforcement
- offline callee handling
- accept from one callee client stops other ringing clients
- idempotent reject/cancel/hangup
- timeout creates one call record message
- signaling relay rejects non-participants and wrong call ids
- ICE credential generation has expected expiry and HMAC shape

Frontend tests:

- call state transitions in `CallProvider`/`CallEngine` with mocked WebRTC APIs
- incoming dialog accept/reject behavior
- call buttons only render for active direct conversations
- call overlay controls invoke mute/camera/hangup actions
- call event messages render the correct outcome text

Manual acceptance:

- desktop Chrome/Edge/Safari direct calls
- desktop Chrome to iOS Safari
- desktop Chrome to Android Chrome
- mobile network to home/office network with TURN relay confirmed
- denied microphone/camera permissions
- callee busy, callee offline, no-answer timeout, network interruption

## Implementation Order

1. Add database migrations for call sessions, participant busy locks, and call event messages.
2. Extend backend message DTOs and frontend message rendering for `call_event`.
3. Add backend `calls` module and WebSocket command/event types.
4. Add ICE server endpoint and TURN credential generation.
5. Add Docker Compose/Caddy/coturn configuration and deployment docs.
6. Add frontend call state module, WebRTC engine, and call UI.
7. Add ringtone, timeout, busy, multi-client ringing convergence, and mobile polish.
8. Run cross-browser and cross-network manual acceptance.

## Open Decisions Closed in This Design

- Calls start only from existing direct conversations.
- First version includes full C-level experience: ringtone, busy, timeout, interruption notices, mute, camera toggle, and hangup.
- Public stable connectivity is required, so coturn is part of deployment.
- Deployment target is a single VPS with Docker Compose.
- All online callee clients ring; first accept wins.
- Call results are written as simple but detailed call record messages.
- Audio and video call buttons are separate.
- Desktop and mobile browsers are in scope.
- Caddy provides HTTPS.
- TURN credentials use short-lived shared-secret authentication.
- Busy rule is user-global across all clients.
