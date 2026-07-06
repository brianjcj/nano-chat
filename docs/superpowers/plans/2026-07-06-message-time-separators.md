# Message Time Separators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chat message timestamps out of bubbles into subtle separators above messages, suppressing separators within five minutes of the last displayed separator.

**Architecture:** Keep all behavior in `MessageList.tsx`. Add a small helper that annotates messages with `showTimestamp` based on each message's `created_at`, then render a centered muted `<time>` row before messages that need it. Keep `formatMessageSentTime` from `shared/utils/message.ts` for display formatting.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library.

## Global Constraints

- Do not change backend APIs or WebSocket protocol.
- Use existing `created_at` message field.
- Timestamp format remains: today `HH:mm`; non-today `MM-DD HH:mm`.
- Show the first message timestamp.
- Suppress the next timestamp when the message time is not more than 5 minutes after the previous displayed timestamp.
- Do not render timestamps inside message bubbles.
- Keep existing sequence, pending, failed, retry, scroll, and call-event behavior.

---

### Task 1: Message time separators

**Files:**
- Modify: `web/src/features/im/components/MessageList.tsx`
- Modify: `web/src/features/im/components/MessageList.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage.created_at` and `formatMessageSentTime(createdAt: string, now?: Date): string`
- Produces: visual timestamp separator rows above selected messages

- [ ] **Step 1: Write failing render tests**

In `web/src/features/im/components/MessageList.test.tsx`, update timestamp tests to assert:

```ts
expect(screen.getByText("14:05").closest("li")).toHaveClass("justify-center");
expect(screen.getByText("14:05").closest("li")?.nextElementSibling).toHaveTextContent("Message 1");
```

Add a grouping test with messages at `14:00`, `14:04`, and `14:06`, asserting `14:00` and `14:06` are rendered and `14:04` is not.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test src/features/im/components/MessageList.test.tsx`
Expected: FAIL because timestamps are still inside bubbles and every message timestamp renders.

- [ ] **Step 3: Implement separator rendering**

In `MessageList.tsx`, create a helper that walks the ordered `messages`, tracks `lastDisplayedTimestampMs`, and returns rows with `showTimestamp`. Render each selected timestamp as a centered muted `<li>` immediately before its message `<li>`. Remove `<time>` from `MessageBubble` and remove the call-event timestamp below its pill.

- [ ] **Step 4: Run focused tests**

Run: `cd web && pnpm test src/features/im/components/MessageList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run full web verification**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: PASS.
