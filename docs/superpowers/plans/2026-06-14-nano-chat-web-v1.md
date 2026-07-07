# Nano Chat Web 应用 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nano Chat v1 Web application in `web/`, wire it to the existing Rust/Axum backend, and serve the production build from the Rust service.

**Architecture:** The Web app is a React/Vite SPA with a Slack-lite shell, an IM feature slice, typed HTTP/WebSocket clients, TanStack Query for server state, Zustand for local UI/session state, and i18next for `zh-CN`/`en-US`. The Rust backend remains the API/WebSocket owner and gains static `web/dist` serving with SPA fallback for production.

**Tech Stack:** React, TypeScript, Vite, pnpm, Tailwind CSS, shadcn/Radix primitives, TanStack Query, Zustand, React Router, i18next/react-i18next, Vitest, React Testing Library, Axum static file serving.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-06-14-nano-chat-web-design.md`
- Backend API docs: `docs/api.md`
- Glossary: `CONTEXT.md`
- Static serving ADR: `docs/adr/0002-serve-web-app-from-chat-service.md`

## Global Execution Rules

- Use TDD for behavior changes. Write a failing test, run it and confirm the expected failure, implement, run it green.
- Commit after each task.
- Keep Web app code under `web/`; do not move existing Rust backend files except where static serving or Docker integration requires it.
- If `pnpm` is missing, activate it with Corepack before running Web commands:

```bash
corepack prepare pnpm@10.24.0 --activate
```

- Use these backend DB test settings when needed:

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test
```

- Do not add unsupported product features: media, contacts, fuzzy user search, browser notifications, PWA, message edit/delete/recall, exited group history, or local persisted message history.

## Planned File Structure

### New Web app files

- `web/package.json` — scripts and frontend dependencies.
- `web/pnpm-lock.yaml` — pnpm lockfile.
- `web/index.html` — Vite entry HTML.
- `web/vite.config.ts` — React, Tailwind, alias, test config, and local API/WS proxy.
- `web/tsconfig*.json` — TypeScript project config.
- `web/eslint.config.js` — lint config.
- `web/src/main.tsx` — React root.
- `web/src/app/App.tsx` — providers and router.
- `web/src/app/router.tsx` — route tree and auth redirects.
- `web/src/app/queryClient.ts` — TanStack Query client defaults.
- `web/src/app/test-utils.tsx` — test render helpers.
- `web/src/styles.css` — Tailwind import, design tokens, base app styles.
- `web/src/shared/api/types.ts` — DTOs matching `docs/api.md`.
- `web/src/shared/api/client.ts` — typed HTTP client and API error parsing.
- `web/src/shared/api/client.test.ts` — API client tests.
- `web/src/shared/session/sessionStore.ts` — localStorage-backed session store.
- `web/src/shared/session/sessionStore.test.ts` — session tests.
- `web/src/shared/i18n/i18n.ts` — i18next initialization.
- `web/src/shared/i18n/resources.ts` — `zh-CN`/`en-US` resources.
- `web/src/shared/i18n/i18n.test.ts` — translation tests.
- `web/src/shared/realtime/realtimeClient.ts` — WebSocket client.
- `web/src/shared/realtime/realtimeClient.test.ts` — realtime command/event tests using a fake WebSocket.
- `web/src/shared/realtime/useRealtimeBridge.ts` — bridge from WS events to Query/Zustand state.
- `web/src/shared/ui/*` — small project UI primitives and shadcn-style components used by the app.
- `web/src/shared/utils/avatar.ts` — deterministic initials/gradient avatar helpers.
- `web/src/shared/utils/message.ts` — UTF-8 byte counting, `client_msg_id` generation, message ordering helpers.
- `web/src/features/auth/*` — login/register routes, forms, hooks.
- `web/src/features/shell/*` — responsive shell, desktop rail, mobile bottom nav, user menu.
- `web/src/features/im/*` — conversation list, chat view, message list/input, direct draft, group flows, member panel, cache update helpers.

### Backend files to modify

- `Cargo.toml` — add static file serving dependency if needed.
- `src/config.rs` — add `web_dist_dir` config with `WEB_DIST_DIR` env defaulting to `web/dist`.
- `src/app.rs` — add SPA static serving fallback after API/WS/health routes.
- `tests/static_web.rs` — backend static serving tests.
- `Dockerfile` — build Web app and copy `web/dist` into final image.
- `.dockerignore` — keep Docker context lean while allowing Web sources.
- `.env.example`, `docs/api.md` — document Web/static config and local dev.

---

## Task 1: Web Tooling Scaffold and Soft-Social UI Foundation

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.app.json`
- Create: `web/tsconfig.node.json`
- Create: `web/eslint.config.js`
- Create: `web/src/main.tsx`
- Create: `web/src/app/App.tsx`
- Create: `web/src/app/queryClient.ts`
- Create: `web/src/app/test-utils.tsx`
- Create: `web/src/styles.css`
- Create: `web/src/shared/ui/button.tsx`
- Create: `web/src/shared/ui/input.tsx`
- Create: `web/src/shared/ui/textarea.tsx`
- Create: `web/src/shared/ui/card.tsx`
- Create: `web/src/shared/ui/dialog.tsx`
- Create: `web/src/shared/ui/sheet.tsx`
- Create: `web/src/shared/utils/cn.ts`
- Test: `web/src/app/App.test.tsx`

- [ ] **Step 1: Activate pnpm**

Run:

```bash
corepack prepare pnpm@10.24.0 --activate
pnpm --version
```

Expected: prints `10.24.0` or a compatible pnpm 10.x version.

- [ ] **Step 2: Write scaffold files and a failing smoke test**

Create the Vite app skeleton manually under `web/`. `web/package.json` must include these scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --max-warnings=0",
    "size": "pnpm build && node scripts/report-size.mjs"
  }
}
```

Dependencies must include React, Vite, Tailwind Vite plugin, React Router, TanStack Query, Zustand, i18next/react-i18next, Radix dialog/slot, lucide-react, class utilities, and test tooling. Use Vite React TypeScript patterns from current docs:

```ts
// web/vite.config.ts shape
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/api/v1": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:3000", ws: true }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/app/test-setup.ts",
    globals: true
  }
});
```

Write `web/src/app/App.test.tsx` first:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

it("renders the Nano Chat web application shell marker", () => {
  render(<App />);
  expect(screen.getByText("Nano Chat")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify RED**

Run:

```bash
cd web && pnpm install && pnpm test -- src/app/App.test.tsx
```

Expected: FAIL initially because `App` or test setup is not implemented.

- [ ] **Step 4: Implement minimal app shell and UI foundation**

Implement:

- `App` renders a minimal “Nano Chat” shell marker.
- `main.tsx` imports `styles.css` and renders `<App />`.
- `styles.css` imports Tailwind and defines soft-social CSS variables such as `--background`, `--foreground`, `--primary`, `--bubble-outgoing`, radius, and focus ring styles.
- `shared/ui` exports small shadcn-style components using `cn()` and Radix for dialog/sheet. Keep them focused and only include props used by this app.
- `test-setup.ts` imports `@testing-library/jest-dom/vitest`.

- [ ] **Step 5: Verify scaffold**

Run:

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass. Build output should create `web/dist`.

- [ ] **Step 6: Commit**

```bash
git add web

git commit -m "feat: scaffold nano chat web app"
```

---

## Task 2: Shared API, Session, Environment, and i18n Primitives

**Files:**
- Create: `web/src/shared/api/types.ts`
- Create: `web/src/shared/api/client.ts`
- Create: `web/src/shared/api/client.test.ts`
- Create: `web/src/shared/config/env.ts`
- Create: `web/src/shared/config/env.test.ts`
- Create: `web/src/shared/session/sessionStore.ts`
- Create: `web/src/shared/session/sessionStore.test.ts`
- Create: `web/src/shared/i18n/resources.ts`
- Create: `web/src/shared/i18n/i18n.ts`
- Create: `web/src/shared/i18n/i18n.test.ts`
- Modify: `web/src/app/App.tsx`

- [ ] **Step 1: Write failing tests for API errors, session expiry, env URLs, and language resources**

Tests must assert:

```ts
// API client behavior
// - adds Authorization: Bearer <token>
// - parses { error: { code, message } } into ApiError
// - clears session on 401 through an injected callback

// Session behavior
// - saves and loads access_token/client_id/expires_at/user
// - treats expires_at in the past as expired
// - clear() removes localStorage key

// Env behavior
// - default apiBaseUrl is "/api/v1"
// - default WebSocket URL uses current origin and /ws?version=1
// - explicit VITE_API_BASE_URL and VITE_WS_URL override defaults

// i18n behavior
// - zh-CN and en-US both contain auth.login.title
// - fallback language is zh-CN
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd web && pnpm test -- src/shared/api/client.test.ts src/shared/session/sessionStore.test.ts src/shared/config/env.test.ts src/shared/i18n/i18n.test.ts
```

Expected: FAIL because modules do not exist or functions are not implemented.

- [ ] **Step 3: Implement typed DTOs and API client**

`types.ts` must define DTOs matching `docs/api.md`, including:

- `UserSummary`
- `AuthResponse`
- `ConversationSummary` with `direct_user` and visible `latest_message`
- `Message`
- `ConversationMember`
- `ErrorEnvelope`
- request payloads for register, login, patch me, create group, add member, history query.

`client.ts` must expose a small typed API surface:

```ts
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
}

export function createApiClient(options: {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}): ApiClient;
```

`ApiClient` must include:

- `register`
- `login`
- `getMe`
- `patchMe`
- `lookupUser`
- `listConversations`
- `createGroup`
- `listMembers`
- `addMember`
- `leaveGroup`
- `listMessages`

- [ ] **Step 4: Implement session and env**

`sessionStore.ts` must persist a single JSON object under `nano-chat.session.v1`, with defensive parsing and expiry checks.

`env.ts` must build:

```ts
export type AppEnv = { apiBaseUrl: string; wsUrl: string };
export function getAppEnv(metaEnv?: ImportMetaEnv, locationLike?: Location): AppEnv;
```

- [ ] **Step 5: Implement i18n resources**

Provide `zh-CN` and `en-US` resources for auth, shell, im, errors, common. Include all labels used by Tasks 3-7, such as login/register titles, conversation list empty state, direct draft labels, group creation labels, send failure, reconnecting, draining, and validation errors.

Initialize i18next with:

- supported languages `zh-CN`, `en-US`
- fallback `zh-CN`
- browser language detection with localStorage cache
- `escapeValue: false` for React

- [ ] **Step 6: Verify**

Run:

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web

git commit -m "feat: add web api session and i18n primitives"
```

---

## Task 3: Routing, Auth Screens, and Protected App Entry

**Files:**
- Create: `web/src/app/router.tsx`
- Modify: `web/src/app/App.tsx`
- Create: `web/src/features/auth/AuthLayout.tsx`
- Create: `web/src/features/auth/LoginPage.tsx`
- Create: `web/src/features/auth/RegisterPage.tsx`
- Create: `web/src/features/auth/authHooks.ts`
- Create: `web/src/features/auth/authRoutes.test.tsx`
- Create: `web/src/features/shell/AppShellPlaceholder.tsx`
- Modify: `web/src/app/test-utils.tsx`

- [ ] **Step 1: Write failing route/auth tests**

Tests must cover:

- unauthenticated `/app/im` redirects to `/login`
- authenticated `/login` redirects to `/app/im`
- login form calls `api.login`, stores session, and navigates to `/app/im`
- register form calls `api.register`, stores session, and navigates to `/app/im`
- invalid credentials render inline translated error rather than a toast-only error

Use a memory router test helper in `web/src/app/test-utils.tsx` that can inject fake session and fake API client.

- [ ] **Step 2: Run tests to verify RED**

```bash
cd web && pnpm test -- src/features/auth/authRoutes.test.tsx
```

Expected: FAIL because routes/pages are missing.

- [ ] **Step 3: Implement provider and route tree**

Implement App providers:

- `I18nextProvider` or initialized i18next import
- `QueryClientProvider`
- API/session context
- router provider

Routes:

- `/login`
- `/register`
- `/app/im`
- `/app/im/conversations/:conversationId`
- fallback redirect to `/app/im` when authenticated, `/login` when not.

Protected route uses `SessionStore.getValidSession()`.

- [ ] **Step 4: Implement auth pages**

Login fields:

- username
- password

Register fields:

- username
- display name optional
- password

Both forms:

- disable submit while pending
- render field/form errors inline
- use API error code mapping from i18n
- store `AuthResponse` in session store on success

- [ ] **Step 5: Verify**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web

git commit -m "feat: add web auth routes"
```

---

## Task 4: IM Query Hooks, Realtime Client, and Cache Update Logic

**Files:**
- Create: `web/src/shared/realtime/protocol.ts`
- Create: `web/src/shared/realtime/realtimeClient.ts`
- Create: `web/src/shared/realtime/realtimeClient.test.ts`
- Create: `web/src/shared/realtime/useRealtimeBridge.ts`
- Create: `web/src/features/im/api/imQueries.ts`
- Create: `web/src/features/im/state/imStore.ts`
- Create: `web/src/features/im/state/cacheUpdates.ts`
- Create: `web/src/features/im/state/cacheUpdates.test.ts`
- Modify: `web/src/app/App.tsx`

- [ ] **Step 1: Write failing realtime/cache tests**

Tests must assert:

- `RealtimeClient` builds `/ws?version=1&token=<token>` when given configured ws base.
- `sendCommand` serializes envelopes with `id`, `type`, and snake_case payload.
- `message.created` updates the matching conversation latest message and inserts the message into message cache without duplicates.
- `message.created` for a non-current conversation increments local unread count.
- a sequence gap in the current conversation schedules a history sync request marker.
- `server.draining` updates connection status to `draining`.

- [ ] **Step 2: Run tests to verify RED**

```bash
cd web && pnpm test -- src/shared/realtime/realtimeClient.test.ts src/features/im/state/cacheUpdates.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement protocol types**

Define client commands:

- `message.send`
- `direct_message.send`
- `conversation.read`
- `heartbeat.ping`

Define server events and responses:

- `message.created`
- `conversation.read_updated`
- `conversation.member_added`
- `conversation.member_left`
- `conversation.dissolved`
- `server.draining`
- `error`
- `*.ok`

- [ ] **Step 4: Implement RealtimeClient**

Behavior:

- one connection per app instance
- explicit `connect(session)` / `disconnect()`
- reconnect with bounded backoff after unexpected close
- periodic `heartbeat.ping`
- command promises resolve on matching response id or reject on matching error
- emits parsed events to subscribers
- exposes status: `idle`, `connecting`, `connected`, `reconnecting`, `draining`, `closed`

Use injectable `WebSocketCtor` and timer hooks for tests.

- [ ] **Step 5: Implement IM Query hooks and cache updates**

`imQueries.ts` must provide query keys and hooks for:

- conversations
- messages by conversation
- members by conversation

`cacheUpdates.ts` must provide pure functions that update TanStack Query cache for realtime events. Keep rules consistent with spec: backend is authoritative, local updates are immediate but refreshed on reconnect.

`imStore.ts` must store:

- current feature area, current conversation id, direct draft, connection status
- local unread corrections
- history backfill markers
- mobile panel state

- [ ] **Step 6: Wire realtime bridge**

In authenticated app area, start RealtimeClient after session is valid and stop it on logout/unmount. On reconnect, invalidate conversation list and current conversation messages.

- [ ] **Step 7: Verify**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add web

git commit -m "feat: add web realtime state bridge"
```

---

## Task 5: Responsive Shell, Conversation List, Avatar, and User Menu

**Files:**
- Create: `web/src/shared/utils/avatar.ts`
- Create: `web/src/shared/utils/avatar.test.ts`
- Create: `web/src/features/shell/AppShell.tsx`
- Create: `web/src/features/shell/DesktopRail.tsx`
- Create: `web/src/features/shell/MobileFeatureBar.tsx`
- Create: `web/src/features/shell/UserMenu.tsx`
- Create: `web/src/features/shell/AppShell.test.tsx`
- Create: `web/src/features/im/components/ConversationList.tsx`
- Create: `web/src/features/im/components/ConversationList.test.tsx`
- Modify: `web/src/app/router.tsx`

- [ ] **Step 1: Write failing tests**

Tests must assert:

- avatar helper returns stable initials and stable gradient class/token for same user id.
- desktop shell renders feature rail, conversation list region, and main workspace.
- mobile shell renders bottom feature bar and hides desktop rail via responsive classes.
- conversation list renders direct user display, group name, latest visible message body, unread badge, and empty state.
- user menu can change language and logout clears session.

- [ ] **Step 2: Run tests to verify RED**

```bash
cd web && pnpm test -- src/shared/utils/avatar.test.ts src/features/shell/AppShell.test.tsx src/features/im/components/ConversationList.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement avatar and shell**

Implement soft-social shell:

- desktop: grid with left rail, list panel, workspace
- mobile: bottom feature bar and stack navigation
- no fake future features; v1 only IM plus user entry
- connection status banner for reconnecting/draining

- [ ] **Step 4: Implement user menu**

User menu supports:

- showing current username/display name
- editing display name through `patchMe`
- language switch `zh-CN`/`en-US`
- logout that clears session and closes realtime connection via app callback

- [ ] **Step 5: Implement conversation list**

Conversation list uses `useConversationsQuery()` and displays:

- direct conversations using `direct_user`
- group conversations using `name`
- latest visible message summary
- unread count from backend plus local corrections
- active empty groups
- loading/error/empty states

- [ ] **Step 6: Verify**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web

git commit -m "feat: add responsive chat shell"
```

---

## Task 6: Chat View, Message History, Read Tracking, and Text Sending

**Files:**
- Create: `web/src/shared/utils/message.ts`
- Create: `web/src/shared/utils/message.test.ts`
- Create: `web/src/features/im/components/ChatView.tsx`
- Create: `web/src/features/im/components/MessageList.tsx`
- Create: `web/src/features/im/components/MessageInput.tsx`
- Create: `web/src/features/im/components/ChatView.test.tsx`
- Create: `web/src/features/im/hooks/useConversationMessages.ts`
- Create: `web/src/features/im/hooks/useMarkRead.ts`
- Create: `web/src/features/im/hooks/useSendMessage.ts`

- [ ] **Step 1: Write failing tests**

Tests must assert:

- `utf8ByteLength("😀")` returns 4.
- empty/whitespace message is rejected before send.
- message over 4096 UTF-8 bytes is rejected before send.
- Enter sends and Shift+Enter inserts newline.
- entering a conversation requests latest messages with `before_seq = latest_message_seq + 1`.
- older history uses `before_seq = current minimum message_seq`.
- successful send inserts pending message, sends WS command with `client_msg_id`, and replaces pending with server message on ack.
- failed send marks pending message failed and exposes retry.
- when page is visible and scroll is near bottom, read tracking sends `conversation.read` with highest contiguous loaded seq.

- [ ] **Step 2: Run tests to verify RED**

```bash
cd web && pnpm test -- src/shared/utils/message.test.ts src/features/im/components/ChatView.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement message helpers**

`message.ts` must provide:

```ts
export function utf8ByteLength(value: string): number;
export function validateMessageBody(body: string, maxBytes?: number): { ok: true } | { ok: false; code: "empty_message" | "message_too_large" };
export function createClientMsgId(): string;
export function mergeMessagesBySeq(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[];
```

Use browser `TextEncoder` for byte length.

- [ ] **Step 4: Implement history hooks**

`useConversationMessages` must:

- derive latest fetch from selected conversation summary
- fetch latest 50 with `before_seq = latest_message_seq + 1`
- load older pages with smaller `before_seq`
- expose highest contiguous seq for read tracking and sync

- [ ] **Step 5: Implement send hooks and components**

`MessageInput`:

- auto-growing textarea
- Enter/Shift+Enter behavior
- inline validation
- disabled when conversation dissolved/unavailable

`useSendMessage`:

- optimistic pending message
- `message.send` for existing conversations
- replacement on ok
- failed state on business/network errors
- retry reuses same `client_msg_id` for same pending request

`MessageList`:

- renders incoming/outgoing bubbles
- renders pending and failed states
- prepend history while preserving scroll position
- new message indicator when not near bottom

- [ ] **Step 6: Implement read tracking**

`useMarkRead` sends `conversation.read` only when:

- selected conversation is real, not draft
- document visibility is visible
- message list is near bottom
- highest contiguous loaded seq is greater than current read seq

- [ ] **Step 7: Verify**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add web

git commit -m "feat: add chat view and message sending"
```

---

## Task 7: Direct Draft, Group Creation, Member Management, and IM Routes

**Files:**
- Create: `web/src/features/im/components/NewDirectDialog.tsx`
- Create: `web/src/features/im/components/DirectDraftView.tsx`
- Create: `web/src/features/im/components/CreateGroupDialog.tsx`
- Create: `web/src/features/im/components/MemberPanel.tsx`
- Create: `web/src/features/im/components/GroupActions.test.tsx`
- Create: `web/src/features/im/components/DirectDraft.test.tsx`
- Modify: `web/src/features/im/components/ConversationList.tsx`
- Modify: `web/src/features/im/components/ChatView.tsx`
- Modify: `web/src/app/router.tsx`

- [ ] **Step 1: Write failing tests**

Tests must assert:

- new direct dialog performs exact username lookup and creates a direct draft rather than an empty conversation.
- direct draft first send uses `direct_message.send` and navigates to the real conversation id from ack.
- create group requires non-empty name and at least one other member before submit.
- create group uses exact username lookup to add members.
- successful group creation navigates to the new group conversation.
- member panel lists active members, can add member, and can leave group.
- leaving a group navigates back to `/app/im` and invalidates conversation list.

- [ ] **Step 2: Run tests to verify RED**

```bash
cd web && pnpm test -- src/features/im/components/DirectDraft.test.tsx src/features/im/components/GroupActions.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement direct draft flow**

- `NewDirectDialog` has exact username input and lookup button.
- Found user opens `DirectDraftView` through IM store state.
- Draft page clearly states that the conversation appears after first message.
- First send uses `direct_message.send` with `target_username` or `target_user_id`.
- Ack replaces draft with real conversation and navigates to `/app/im/conversations/:conversation_id`.

- [ ] **Step 4: Implement group creation**

- Dialog/sheet includes group name and exact username lookup.
- Selected members displayed as removable chips.
- Submit disabled until name is valid and at least one other member is selected.
- On success invalidate conversation list and navigate to group conversation.

- [ ] **Step 5: Implement member panel and leave behavior**

- Member panel fetches active members.
- Add member uses exact lookup and `addMember` API.
- Leave group calls `leaveGroup`, closes current conversation, navigates to `/app/im`, shows translated confirmation/notice, and invalidates conversation list.
- Dissolved/member-left realtime events close current conversation when applicable.

- [ ] **Step 6: Verify**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web

git commit -m "feat: add direct and group chat flows"
```

---

## Task 8: Backend Static Web Serving and Docker Integration

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/config.rs`
- Modify: `src/app.rs`
- Create: `tests/static_web.rs`
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `.env.example`
- Modify: `docs/api.md`

- [ ] **Step 1: Write failing backend static serving tests**

Create `tests/static_web.rs` with tests that build an app using a temporary web dist directory:

- `GET /` returns `index.html` with `text/html`.
- `GET /assets/app.js` returns the asset file.
- `GET /app/im/conversations/abc` falls back to `index.html`.
- `GET /api/v1/unknown` still returns API-style 404 and is not swallowed by SPA fallback.
- `GET /ws?version=1` is not swallowed by SPA fallback.

Use existing test helpers for `AppState` when possible. If DB pool is needed only for state construction, use the same test DB guard pattern as other integration tests.

- [ ] **Step 2: Run test to verify RED**

```bash
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test static_web -- --nocapture
```

Expected: FAIL because static serving is not implemented.

- [ ] **Step 3: Add `WEB_DIST_DIR` config**

Add `web_dist_dir: String` to `Config`, defaulting to `web/dist` when `WEB_DIST_DIR` is not present. Update `Debug` and config tests.

- [ ] **Step 4: Implement static serving in `src/app.rs`**

Use `tower_http::services::ServeDir`/`ServeFile` or equivalent. Router ordering must preserve:

- `/healthz`
- `/readyz`
- `/ws`
- `/api/v1/*`

Only non-backend routes fall back to `index.html`. Missing assets under `/assets/*` should return 404 instead of `index.html` if practical; SPA app routes should fall back.

- [ ] **Step 5: Update Dockerfile**

Use a multi-stage build:

1. Node/pnpm stage builds `web/dist`.
2. Rust builder builds backend with `cargo build --release --locked`.
3. Final image copies binary, migrations, and `web/dist`.

Keep build cache reasonable by copying Web lock/package files before Web source.

- [ ] **Step 6: Update docs/env**

Document:

- `WEB_DIST_DIR`
- local development uses Vite proxy
- production Rust service serves Web build
- Docker image includes Web build

- [ ] **Step 7: Verify**

Run:

```bash
cargo fmt --all
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --test static_web -- --nocapture
cargo test --lib
cargo build --locked
cargo clippy --all-targets -- -D warnings
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock src/config.rs src/app.rs tests/static_web.rs Dockerfile .dockerignore .env.example docs/api.md web

git commit -m "feat: serve web app from chat service"
```

---

## Task 9: End-to-End Web Polish, Bundle Report, and Final Documentation

**Files:**
- Create: `web/scripts/report-size.mjs`
- Create: `web/README.md`
- Modify: `docs/api.md`
- Modify: `docs/superpowers/specs/2026-06-14-nano-chat-web-design.md` only if implementation reveals a documented mismatch that must be corrected.
- Modify: `web/src/**/*` as needed for final integration fixes.

- [ ] **Step 1: Write failing polish tests**

Add or extend tests to cover any integration gaps found after Tasks 1-8. At minimum ensure:

- route `/app/im/conversations/:conversation_id` renders chat workspace when authenticated.
- reconnect banner text is translated in both languages.
- no user-visible text in core auth/shell/IM components bypasses i18n except product name and usernames.

- [ ] **Step 2: Run tests to verify RED if gaps exist**

```bash
cd web && pnpm test
```

Expected: new tests fail before fixes if they cover gaps.

- [ ] **Step 3: Implement bundle size reporter**

Create `web/scripts/report-size.mjs` that:

- reads `web/dist/assets/*.js`
- computes gzip bytes with Node `zlib.gzipSync`
- prints each JS asset and total gzip size
- prints a warning if total initial JS gzip exceeds 250KB
- exits 0 for soft budget warnings

- [ ] **Step 4: Write `web/README.md`**

Document:

- setup with Corepack/pnpm
- `pnpm dev`
- backend dependency and Vite proxy
- environment variables
- quality commands
- production build behavior

- [ ] **Step 5: Final Web verification**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size
```

Expected: all pass; `pnpm size` exits 0 and prints gzip sizes.

- [ ] **Step 6: Full repository verification**

```bash
cargo fmt --all --check
cargo test --lib
docker compose up -d postgres
TEST_DATABASE_URL=postgres://nano:nano@localhost:5432/nano_chat_test cargo test --tests -- --nocapture
cargo test
cargo build --locked
cargo clippy --all-targets -- -D warnings
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size
docker compose --profile app config
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web docs/api.md docs/superpowers/specs/2026-06-14-nano-chat-web-design.md

git commit -m "docs: add web app usage and size report"
```

---

## Plan Self-Review

### Spec coverage

- Scope and non-goals: Tasks 3, 5, 6, 7, 9.
- Web placement in `web/`: Task 1.
- pnpm/Vite/React/TypeScript/Tailwind/shadcn-style components: Task 1.
- Session/localStorage/API/i18n/env: Task 2.
- Auth routes and protected app: Task 3.
- TanStack Query/Zustand/WebSocket bridge: Task 4.
- Responsive Slack-lite shell/mobile bottom bar/soft-social avatar: Task 5.
- Message history/loading/sending/read tracking: Task 6.
- Direct draft/group/member flows: Task 7.
- Static serving from Rust/Docker/docs: Task 8.
- Bundle soft budget and final docs: Task 9.

### Placeholder scan

This plan intentionally contains no unresolved markers. Every task has concrete files, behavior, commands, and commit message.

### Type consistency

The planned DTO names match the backend API docs: `UserSummary`, `AuthResponse`, `ConversationSummary`, `Message`, `ConversationMember`, and error envelope. The planned WebSocket command/event names match `docs/api.md`: `message.send`, `direct_message.send`, `conversation.read`, `heartbeat.ping`, `message.created`, `conversation.read_updated`, `conversation.member_added`, `conversation.member_left`, `conversation.dissolved`, and `server.draining`.
