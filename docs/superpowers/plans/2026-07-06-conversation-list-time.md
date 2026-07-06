# Conversation List Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display latest-message timestamps in the conversation list with calendar-aware, localized weekday formatting.

**Architecture:** Add a pure formatter to `web/src/shared/utils/message.ts` and keep React responsible only for passing the active i18n language and rendering the result. Preserve existing message timestamp behavior by introducing a separate conversation-list formatter.

**Tech Stack:** React 19, TypeScript, react-i18next, Vitest, Testing Library.

## Global Constraints

- Today format is `HH:mm`.
- Same week format is localized weekday name; weeks start on Monday.
- Same year format is `MM/DD`.
- Different year format is `YY/MM/DD`.
- Empty conversations render no timestamp.
- Do not overwrite unrelated uncommitted changes.

---

### Task 1: Conversation List Time Formatter and Rendering

**Files:**
- Modify: `web/src/shared/utils/message.ts`
- Test: `web/src/shared/utils/message.test.ts`
- Modify: `web/src/features/im/components/ConversationList.tsx`
- Test: `web/src/features/im/components/ConversationList.test.tsx`

**Interfaces:**
- Produces: `formatConversationListTime(createdAt: string, locale: string, now?: Date): string`
- Consumes: `conversation.latest_message?.created_at`, `i18n.language`

- [ ] **Step 1: Write failing formatter tests**

Add tests in `web/src/shared/utils/message.test.ts` for:

```ts
expect(formatConversationListTime("2026-07-06T14:05:00", "zh-CN", new Date("2026-07-06T23:00:00"))).toBe("14:05");
expect(formatConversationListTime("2026-07-06T09:00:00", "zh-CN", new Date("2026-07-08T12:00:00"))).toBe("星期一");
expect(formatConversationListTime("2026-07-06T09:00:00", "en-US", new Date("2026-07-08T12:00:00"))).toBe("Monday");
expect(formatConversationListTime("2026-06-30T09:00:00", "zh-CN", new Date("2026-07-08T12:00:00"))).toBe("06/30");
expect(formatConversationListTime("2025-12-31T09:00:00", "zh-CN", new Date("2026-07-08T12:00:00"))).toBe("25/12/31");
```

- [ ] **Step 2: Run formatter tests and verify RED**

Run: `cd web && pnpm test src/shared/utils/message.test.ts`

Expected: FAIL because `formatConversationListTime` is not exported.

- [ ] **Step 3: Implement formatter**

Add `formatConversationListTime(createdAt, locale, now)` to `web/src/shared/utils/message.ts` using local dates, Monday-start week boundaries, `padTwoDigits`, and `Intl.DateTimeFormat(locale, { weekday: "long" })`.

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run: `cd web && pnpm test src/shared/utils/message.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing component tests**

Add a `ConversationList` test that renders one old latest message and one empty group, then asserts the old latest message shows `25/12/31` while the empty group does not expose an extra timestamp.

- [ ] **Step 6: Run component test and verify RED**

Run: `cd web && pnpm test src/features/im/components/ConversationList.test.tsx`

Expected: FAIL because the conversation list does not render latest-message timestamps yet.

- [ ] **Step 7: Implement rendering**

Import `formatConversationListTime`, read `i18n.language` from `useTranslation()`, calculate a timestamp for conversations with latest messages, and render it in the title row metadata area without removing the unread badge.

- [ ] **Step 8: Run targeted tests and verify GREEN**

Run:

```bash
cd web && pnpm test src/shared/utils/message.test.ts src/features/im/components/ConversationList.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run: `cd web && pnpm typecheck`

Expected: PASS.
