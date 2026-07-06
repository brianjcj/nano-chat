# Message Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each web chat message's sent time using today-only time and date+time for older messages.

**Architecture:** Keep formatting in the web client. Add a small pure helper in `web/src/shared/utils/message.ts`, test it, and render the formatted value in `MessageList` metadata for normal and call-event messages.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library.

## Global Constraints

- Do not change backend APIs or WebSocket protocol.
- Use existing `created_at` message field.
- Format: today `HH:mm`; non-today `MM-DD HH:mm`.
- Keep existing sequence, pending, failed, and retry UI behavior.

---

### Task 1: Message timestamp formatter and rendering

**Files:**
- Modify: `web/src/shared/utils/message.ts`
- Modify: `web/src/shared/utils/message.test.ts`
- Modify: `web/src/features/im/components/MessageList.tsx`
- Modify: `web/src/features/im/components/MessageList.test.tsx`

**Interfaces:**
- Produces: `formatMessageSentTime(createdAt: string, now?: Date): string`
- Consumes: `ChatMessage.created_at`

- [ ] **Step 1: Write failing formatter tests**

Add tests in `web/src/shared/utils/message.test.ts`:

```ts
expect(formatMessageSentTime("2026-07-06T14:05:00.000Z", new Date("2026-07-06T23:00:00.000Z"))).toBe("14:05");
expect(formatMessageSentTime("2026-07-05T09:08:00.000Z", new Date("2026-07-06T23:00:00.000Z"))).toBe("07-05 09:08");
```

- [ ] **Step 2: Run formatter test to verify it fails**

Run: `cd web && pnpm test src/shared/utils/message.test.ts`
Expected: FAIL because `formatMessageSentTime` is not exported.

- [ ] **Step 3: Implement formatter**

Add `formatMessageSentTime(createdAt: string, now = new Date())` to `web/src/shared/utils/message.ts` using `Date`, two-digit month/day/hour/minute, and same local year/month/day comparison.

- [ ] **Step 4: Run formatter test to verify it passes**

Run: `cd web && pnpm test src/shared/utils/message.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing render test**

Add a test in `web/src/features/im/components/MessageList.test.tsx` that renders a message with a known `created_at` and asserts the timestamp text is visible.

- [ ] **Step 6: Run render test to verify it fails**

Run: `cd web && pnpm test src/features/im/components/MessageList.test.tsx`
Expected: FAIL because timestamp text is not rendered.

- [ ] **Step 7: Render timestamp**

Import `formatMessageSentTime` in `MessageList.tsx` and display it in message metadata. For event messages, include timestamp as subtle text under the event pill.

- [ ] **Step 8: Run focused tests**

Run:
```bash
cd web && pnpm test src/shared/utils/message.test.ts src/features/im/components/MessageList.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Run web quality checks**

Run:
```bash
cd web && pnpm typecheck && pnpm test
```
Expected: PASS.
