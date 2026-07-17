#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/dev-tmux.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOG="$TMP_DIR/commands.log"
mkdir -p "$TMP_DIR/bin"

write_fake() {
  local name="$1"
  cat >"$TMP_DIR/bin/$name" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$(basename "$0")" "$@" >>"$NANO_CHAT_FAKE_LOG"
printf '\n' >>"$NANO_CHAT_FAKE_LOG"
case "$(basename "$0")" in
  tmux)
    if [[ "${1:-}" == "has-session" ]]; then
      exit "${NANO_CHAT_FAKE_TMUX_HAS_SESSION_EXIT:-1}"
    fi
    ;;
esac
exit 0
FAKE
  chmod +x "$TMP_DIR/bin/$name"
}

for cmd in tmux docker cargo sqlx pnpm; do
  write_fake "$cmd"
done

run_script() {
  : >"$LOG"
  NANO_CHAT_FAKE_LOG="$LOG" \
  NANO_CHAT_TMUX_NO_ATTACH=1 \
  PATH="$TMP_DIR/bin:$PATH" \
  bash "$SCRIPT" "$@"
}

assert_log_contains() {
  local needle="$1"
  if ! tr '\0' ' ' <"$LOG" | grep -Fq -- "$needle"; then
    echo "Expected log to contain: $needle" >&2
    echo "Actual log:" >&2
    tr '\0' ' ' <"$LOG" >&2
    exit 1
  fi
}

run_script dev
assert_log_contains "tmux new-session -d -s nano-chat -n backend"
assert_log_contains "export PATH="
assert_log_contains "docker compose up -d postgres"
assert_log_contains "sqlx migrate run"
assert_log_contains "cargo run"
assert_log_contains "pnpm dev"

run_script compose
assert_log_contains "tmux new-session -d -s nano-chat -n compose"
assert_log_contains "export PATH="
assert_log_contains "docker compose up --build"

: >"$LOG"
NANO_CHAT_FAKE_LOG="$LOG" \
NANO_CHAT_TMUX_NO_ATTACH=1 \
NANO_CHAT_FAKE_TMUX_HAS_SESSION_EXIT=0 \
PATH="$TMP_DIR/bin:$PATH" \
bash "$SCRIPT" dev
assert_log_contains "tmux has-session -t nano-chat"
if tr '\0' ' ' <"$LOG" | grep -Fq -- "docker compose up -d postgres"; then
  echo "Expected existing session path not to start services" >&2
  exit 1
fi

echo "dev-tmux tests passed"
