#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${NANO_CHAT_TMUX_SESSION:-nano-chat}"
MODE="${1:-dev}"
NO_ATTACH="${NANO_CHAT_TMUX_NO_ATTACH:-0}"

usage() {
  cat <<USAGE
Usage: ./scripts/dev-tmux.sh [dev|compose|logs|stop]

Commands:
  dev      Start Postgres, run migrations, then run the Rust backend and Vite web app in tmux (default)
  compose  Run the full Docker Compose stack in tmux
  logs     Attach to the tmux session
  stop     Stop the tmux session

Environment:
  NANO_CHAT_TMUX_SESSION  Override tmux session name (default: nano-chat)
USAGE
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

load_env() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

q() {
  printf '%q' "$1"
}

session_exists() {
  tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

attach_session() {
  echo "tmux session '$SESSION_NAME' is ready. Attach with: tmux attach -t $(q "$SESSION_NAME")"
  if [[ "$NO_ATTACH" == "1" ]]; then
    return 0
  fi
  exec tmux attach -t "$SESSION_NAME"
}

stop_session() {
  require_cmd tmux
  if session_exists; then
    tmux kill-session -t "$SESSION_NAME"
    echo "Stopped tmux session '$SESSION_NAME'."
  else
    echo "No tmux session named '$SESSION_NAME' is running."
  fi
}

local_database_url() {
  local user="${POSTGRES_USER:-nano}"
  local password="${POSTGRES_PASSWORD:-nano}"
  local db="${POSTGRES_DB:-nano_chat_test}"
  local port="${POSTGRES_PORT:-5432}"
  printf 'postgres://%s:%s@localhost:%s/%s' "$user" "$password" "$port" "$db"
}

start_dev() {
  require_cmd tmux
  require_cmd docker
  require_cmd cargo
  require_cmd sqlx
  require_cmd pnpm
  load_env

  if session_exists; then
    attach_session
    return 0
  fi

  local postgres_user="${POSTGRES_USER:-nano}"
  local postgres_db="${POSTGRES_DB:-nano_chat_test}"
  local database_url="${DATABASE_URL:-$(local_database_url)}"
  local jwt_secret="${JWT_SECRET:-change-me-development-secret-at-least-32-bytes}"
  local bind_addr="${BIND_ADDR:-127.0.0.1:3000}"
  local rust_log="${RUST_LOG:-nano_chat=debug,tower_http=info}"

  local path_export
  path_export="export PATH=$(q "$PATH");"

  local backend_cmd
  backend_cmd="set -e; $path_export cd $(q "$ROOT_DIR") && docker compose up -d postgres && echo 'Waiting for Postgres...' && until docker compose exec -T postgres pg_isready -U $(q "$postgres_user") -d $(q "$postgres_db"); do sleep 1; done && DATABASE_URL=$(q "$database_url") sqlx migrate run && DATABASE_URL=$(q "$database_url") JWT_SECRET=$(q "$jwt_secret") BIND_ADDR=$(q "$bind_addr") RUST_LOG=$(q "$rust_log") cargo run"

  local web_cmd
  web_cmd="set -e; $path_export cd $(q "$ROOT_DIR/web") && pnpm dev"

  tmux new-session -d -s "$SESSION_NAME" -n backend -c "$ROOT_DIR"
  tmux send-keys -t "$SESSION_NAME:backend.0" "$backend_cmd" C-m
  tmux split-window -h -t "$SESSION_NAME:backend" -c "$ROOT_DIR/web"
  tmux send-keys -t "$SESSION_NAME:backend.1" "$web_cmd" C-m
  tmux select-layout -t "$SESSION_NAME:backend" even-horizontal
  tmux select-pane -t "$SESSION_NAME:backend.0"

  attach_session
}

start_compose() {
  require_cmd tmux
  require_cmd docker
  load_env

  if session_exists; then
    attach_session
    return 0
  fi

  local path_export
  path_export="export PATH=$(q "$PATH");"

  local compose_cmd
  compose_cmd="set -e; $path_export cd $(q "$ROOT_DIR") && docker compose up --build"

  tmux new-session -d -s "$SESSION_NAME" -n compose -c "$ROOT_DIR"
  tmux send-keys -t "$SESSION_NAME:compose.0" "$compose_cmd" C-m

  attach_session
}

case "$MODE" in
  dev)
    start_dev
    ;;
  compose)
    start_compose
    ;;
  logs)
    require_cmd tmux
    if session_exists; then
      attach_session
    else
      echo "No tmux session named '$SESSION_NAME' is running." >&2
      exit 1
    fi
    ;;
  stop)
    stop_session
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
