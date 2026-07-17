# Deployment Smoke Checklist

Run this after a real VPS deployment (`docker compose up -d --build`) to prove HTTPS, auth, realtime, and WebRTC work outside localhost.

Set the app origin once:

```bash
APP=https://$NANO_CHAT_DOMAIN
```

## Checklist

- [ ] **Containers and HTTP health**
  - `docker compose ps` shows `postgres`, `app`, `caddy`, and `coturn` running.
  - `curl -i "$APP/healthz"` returns `200 OK`.
  - `curl -i "$APP/readyz"` returns `200 OK`.

- [ ] **Register and login**
  - In two different browsers/profiles, register two users, then log out and log back in as each user.
  - If login fails, inspect `docker compose logs -n 100 app caddy`.

- [ ] **Direct messaging and WebSocket sync**
  - From browser A, start a direct conversation with browser B's user and send a message.
  - Browser B receives it without refresh; B replies and A receives it without refresh.
  - Refresh both browsers and confirm the conversation history is still present.
  - In DevTools Network, `/ws?version=1` upgrades with `101` and does not reconnect in a loop.

- [ ] **ICE servers endpoint**
  - While logged in, call `GET $APP/api/v1/calls/ice-servers` with the user's bearer token, or inspect the browser Network request when starting a call.
  - Expect one STUN URL, TURN UDP/TCP URLs, temporary `username`/`credential`, and `expires_at`.

- [ ] **1v1 audio call**
  - Keep both users online in different browsers/profiles.
  - Start an audio call from A to B; B sees the incoming call, accepts, grants microphone permission, and both sides hear audio.
  - Hang up and confirm a call event appears in the conversation.

- [ ] **TURN relay sanity check**
  - Test once from different networks, for example one browser on home/office internet and the other on a phone hotspot.
  - In `chrome://webrtc-internals`, confirm the selected candidate pair uses a `relay` candidate when direct connectivity is not possible.
  - If relay never appears or audio connects only on the same LAN, re-check VPS firewall UDP/TCP 3478, UDP `TURN_RELAY_MIN_PORT`-`TURN_RELAY_MAX_PORT`, `TURN_EXTERNAL_IP`, and `TURN_PUBLIC_HOST`.

- [ ] **Logs during the call**
  - Run `docker compose logs -f app coturn caddy` while placing a call.
  - `app`: no auth/WebSocket/call errors.
  - `coturn`: successful auth/allocation activity, no repeated 401/438 or unreachable relay errors.
  - `caddy`: no TLS or reverse-proxy errors for `/api/v1`, `/ws`, `/healthz`, or `/readyz`.
