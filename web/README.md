# Nano Chat Web

React/Vite web client for Nano Chat. The app talks to the Rust chat service over `/api/v1` and `/ws`.

## Setup

Use Corepack so the project runs with pnpm:

```bash
cd web
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm install
```

## Local development

### tmux helper

From the repository root, start the usual local development stack in tmux:

```bash
./scripts/dev-tmux.sh
```

This starts Postgres through Docker Compose, runs SQL migrations, starts the Rust backend, and starts Vite. Use `./scripts/dev-tmux.sh compose` to run the full Docker Compose stack, `./scripts/dev-tmux.sh logs` to attach to the session, and `./scripts/dev-tmux.sh stop` to close the tmux session.

### Manual startup

Start the Rust backend first from the repository root. The backend reads environment variables directly and does not auto-load `.env`:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test sqlx migrate run
DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test \
  JWT_SECRET=change-me-development-secret-at-least-32-bytes \
  BIND_ADDR=127.0.0.1:3000 \
  cargo run
```

If Postgres and migrations are already ready, only run the final env-prefixed `cargo run` command. See [`docs/api.md`](../docs/api.md#deployment-and-configuration-notes) for full backend setup.

Then start Vite from `web/`:

```bash
pnpm dev
```

The Vite dev server proxies backend traffic to `http://127.0.0.1:3000`:

- `/api/v1` HTTP requests are proxied to the Rust service.
- `/ws` WebSocket upgrades are proxied to the Rust service.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | HTTP API base URL used by the browser client. |
| `VITE_WS_URL` | Current origin + `/ws?version=1` | WebSocket URL used by the realtime client. |

For normal local development, leave both unset and rely on the Vite proxy.

## WebRTC local notes

WebRTC media permission works on localhost during development. For LAN/mobile testing use HTTPS through Caddy or another trusted TLS endpoint. iOS Safari may block ringtone autoplay; the incoming call dialog remains the reliable indicator.

## Quality commands

Run from `web/`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm size
```

`pnpm size` builds the app, gzips `dist/assets/*.js`, prints each JavaScript asset plus the total gzip size, and emits a soft warning if the total built JavaScript gzip size exceeds 250 KB. The warning does not fail the command.

## Production build and serving

`pnpm build` writes the static app to `web/dist`. In production, the Rust service serves that directory (configured by `WEB_DIST_DIR`) alongside `/api/v1`, `/ws`, `/healthz`, and `/readyz`; web routes fall back to `index.html` without swallowing backend routes.

The Docker image build includes `web/dist` and sets `WEB_DIST_DIR=/app/web/dist`, so the container serves the web app and backend from the same origin.
