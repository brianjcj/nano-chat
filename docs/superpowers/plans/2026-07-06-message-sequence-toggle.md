# Message Sequence Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web UI switch that hides message sequence numbers by default and lets users show them when debugging.

**Architecture:** Store the preference in `ChatView` state initialized from `localStorage`, render a compact `# 序号` toggle in the chat header, and pass `showMessageSequenceNumbers` to `MessageList`. `MessageList` remains responsible only for conditional rendering of existing `#message_seq` metadata.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library.

## Global Constraints

- Do not change backend APIs or WebSocket protocol.
- Default sequence-number visibility is off.
- Persist the browser-local setting in `localStorage`.
- Keep pending/failed/retry metadata visible regardless of the sequence-number setting.
- Keep timestamp separators unchanged.

---

### Task 1: Sequence-number visibility prop and tests

**Files:**
- Modify: `web/src/features/im/components/MessageList.tsx`
- Modify: `web/src/features/im/components/MessageList.test.tsx`

**Interfaces:**
- Produces: `showMessageSequenceNumbers?: boolean` prop on `MessageList`
- Consumes: existing `message.message_seq`

- [ ] **Step 1: Write failing tests**

Add tests asserting `#1` is hidden by default and rendered only when `showMessageSequenceNumbers` is true.

- [ ] **Step 2: Run focused test to verify it fails**

Run: `cd web && pnpm test src/features/im/components/MessageList.test.tsx`
Expected: FAIL because `#1` is currently always rendered.

- [ ] **Step 3: Implement prop**

Add optional prop with default `false` and wrap `#message_seq` rendering with `showMessageSequenceNumbers && isServerSequenced(message)`.

- [ ] **Step 4: Run focused test**

Run: `cd web && pnpm test src/features/im/components/MessageList.test.tsx`
Expected: PASS.

### Task 2: Header toggle and persistence

**Files:**
- Modify: `web/src/features/im/components/ChatView.tsx`
- Modify: `web/src/features/im/components/ChatView.test.tsx`
- Modify: `web/src/shared/i18n/resources.ts`

**Interfaces:**
- Consumes: `MessageList showMessageSequenceNumbers` prop
- Produces: browser-local `localStorage` key `nano-chat:show-message-sequence-numbers`

- [ ] **Step 1: Write failing tests**

Add tests asserting sequence numbers are hidden on initial render, become visible after clicking the `# 序号` toggle, and the setting is restored from `localStorage`.

- [ ] **Step 2: Run focused test to verify it fails**

Run: `cd web && pnpm test src/features/im/components/ChatView.test.tsx`
Expected: FAIL because no toggle exists.

- [ ] **Step 3: Implement state and toggle**

In `LoadedChatView`, initialize state from `localStorage`, persist on changes, add a compact button with `aria-pressed`, and pass the state to `MessageList`.

- [ ] **Step 4: Add i18n labels**

Add `im.chat.sequenceToggle` and `im.chat.sequenceToggleAria` translations in English and Chinese resources.

- [ ] **Step 5: Run focused tests**

Run: `cd web && pnpm test src/features/im/components/ChatView.test.tsx src/features/im/components/MessageList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run full web verification**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: PASS.
