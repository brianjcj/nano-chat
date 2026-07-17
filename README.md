# Nano Chat

Nano Chat is a small Rust + React realtime chat app with IM, groups, WebSocket sync, and 1v1 WebRTC calls.

## Quick start

The easiest local startup path is the tmux helper from the repo root:

```bash
./scripts/dev-tmux.sh
```

## Manual startup

For manual frontend setup, see [web/README.md](web/README.md). For backend setup, API details, and environment notes, see [docs/api.md](docs/api.md).

## Quality commands

```bash
cargo test --lib
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests -- --nocapture
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Backend integration tests require Postgres and a test database URL (`TEST_DATABASE_URL`; see `DATABASE_URL` setup in [docs/api.md](docs/api.md)).

## Deployment and WebRTC

See [docs/deployment-webrtc.md](docs/deployment-webrtc.md) and [docs/api.md](docs/api.md).
