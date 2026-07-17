# Local tmux Startup Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local tmux helper that starts Nano Chat in either daily development mode or full Docker Compose mode.

**Architecture:** A single Bash script owns the user-facing command interface and tmux orchestration. A separate Bash test script uses fake executables on `PATH` to verify command behavior without starting real services.

**Tech Stack:** Bash, tmux, Docker Compose, Rust Cargo, SQLx CLI, pnpm, Vite.

## Global Constraints

- Script path: `scripts/dev-tmux.sh`.
- Default command: `./scripts/dev-tmux.sh` runs `dev` mode.
- Supported commands: `dev`, `compose`, `logs`, `stop`.
- tmux session name: `nano-chat` by default, overridable with `NANO_CHAT_TMUX_SESSION`.
- Dev mode starts Postgres, runs migrations, starts Rust backend, and starts Vite web app.
- Compose mode runs full `docker compose up --build`.
- Avoid duplicate services by attaching to an existing session.
- The test must not start real long-running services.

---

### Task 1: Add Behavioral Shell Test

**Files:**
- Create: `scripts/test-dev-tmux.sh`

**Interfaces:**
- Consumes: target script path `scripts/dev-tmux.sh`.
- Produces: executable test command `bash scripts/test-dev-tmux.sh`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-dev-tmux.sh` with fake command shims:

```bash
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
assert_log_contains "docker compose up -d postgres"
assert_log_contains "sqlx migrate run"
assert_log_contains "cargo run"
assert_log_contains "pnpm dev"

run_script compose
assert_log_contains "tmux new-session -d -s nano-chat -n compose"
assert_log_contains "docker compose up --build"

: >"$LOG"
NANO_CHAT_FAKE_LOG="$LOG" \
NANO_CHAT_TMUX_NO_ATTACH=1 \
NANO_CHAT_FAKE_TMUX_HAS_SESSION_EXIT=0 \
PATH="$TMP_DIR/bin:$PATH" \
bash "$SCRIPT" dev
assert_log_contains "tmux attach -t nano-chat"
if tr '\0' ' ' <"$LOG" | grep -Fq -- "docker compose up -d postgres"; then
  echo "Expected existing session path not to start services" >&2
  exit 1
fi

echo "dev-tmux tests passed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test-dev-tmux.sh`

Expected: FAIL because `scripts/dev-tmux.sh` does not exist.

### Task 2: Implement tmux Startup Script

**Files:**
- Create: `scripts/dev-tmux.sh`

**Interfaces:**
- Consumes: optional `.env`, repo paths, external commands.
- Produces: user command `./scripts/dev-tmux.sh [dev|compose|logs|stop]`.

- [ ] **Step 1: Write minimal implementation**

Create `scripts/dev-tmux.sh` as a focused Bash script that validates commands, loads `.env`, starts tmux panes, and honors `NANO_CHAT_TMUX_NO_ATTACH=1` for tests.

- [ ] **Step 2: Run tests to verify pass**

Run: `bash scripts/test-dev-tmux.sh`

Expected: PASS and print `dev-tmux tests passed`.

- [ ] **Step 3: Run shell syntax checks**

Run:

```bash
bash -n scripts/dev-tmux.sh
bash -n scripts/test-dev-tmux.sh
```

Expected: no output and exit code 0.

### Task 3: Document Usage

**Files:**
- Modify: `web/README.md`

**Interfaces:**
- Consumes: script command interface from Task 2.
- Produces: README section describing local tmux usage.

- [ ] **Step 1: Add concise README instructions**

Add a short section before the manual local development commands:

```markdown
### tmux helper

From the repository root, start the usual local development stack in tmux:

```bash
./scripts/dev-tmux.sh
```

This starts Postgres through Docker Compose, runs SQL migrations, starts the Rust backend, and starts Vite. Use `./scripts/dev-tmux.sh compose` to run the full Docker Compose stack, `./scripts/dev-tmux.sh logs` to attach to the session, and `./scripts/dev-tmux.sh stop` to close the tmux session.
```

- [ ] **Step 2: Re-run verification**

Run:

```bash
bash scripts/test-dev-tmux.sh
bash -n scripts/dev-tmux.sh scripts/test-dev-tmux.sh
```

Expected: test prints `dev-tmux tests passed`; syntax checks print no output.

## Self-Review

- Spec coverage: Tasks cover all modes, tmux session reuse, environment defaults, tool checks, and verification.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Script names, command names, session name, and test env variables are consistent across tasks.
