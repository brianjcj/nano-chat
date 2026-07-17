# Local tmux Startup Script Design

## Goal

Add a repository-local script that starts Nano Chat in tmux for local testing. It should support the daily development workflow and a full Docker Compose workflow.

## Modes

- `dev` mode, also the default: start Postgres through Docker Compose, run SQL migrations, run the Rust backend locally, and run the Vite web application locally.
- `compose` mode: run the full Docker Compose stack in tmux.
- `logs` mode: attach to the tmux session.
- `stop` mode: stop the tmux session.

## Script Location and Interface

The script will live at `scripts/dev-tmux.sh` and accept:

```bash
./scripts/dev-tmux.sh [dev|compose|logs|stop]
```

If no mode is provided, it uses `dev`.

## Runtime Behavior

The script will create or reuse a tmux session named `nano-chat`. If that session already exists, the script will attach to it instead of starting duplicate services.

In `dev` mode, tmux panes will run:

1. `docker compose up -d postgres`
2. `sqlx migrate run` against `postgres://nano:nano@localhost:5432/nano_chat_test`
3. `cargo run` for the backend with local development environment variables
4. `cd web && pnpm dev` for the web application

In `compose` mode, tmux will run `docker compose up --build` in a single pane.

## Environment

The script will load `.env` if present. If `.env` is absent, it will use sensible local defaults matching `.env.example`, especially the local Postgres URL and backend bind address.

## Error Handling

The script will fail early if required tools are missing. `dev` mode requires `tmux`, `docker`, `cargo`, `sqlx`, and `pnpm`. `compose` mode requires `tmux` and `docker`.

## Verification

Verification will include shell syntax checking with `bash -n scripts/dev-tmux.sh`. A full service launch may be skipped unless requested, because it starts long-running local services.
