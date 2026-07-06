# Shell Settings Sequence Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the message sequence-number display toggle from the chat header into a settings popup opened from the navigation chrome.

**Architecture:** `useImStore` owns the persisted `showMessageSequenceNumbers` setting. `ShellSettingsMenu` renders the desktop/mobile gear popup and mutates the store, while `ChatView` only consumes the store value when rendering `MessageList`.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Tailwind utilities, lucide-react.

## Global Constraints

- Do not change message fetching or sending behavior.
- Preserve `localStorage` key `nano-chat:show-message-sequence-numbers`.
- Keep the popup as a disclosure region, not an ARIA menu.
- Desktop settings opens from the rail bottom toward the right; mobile settings opens upward from the bottom bar.

---

### Task 1: Move setting state into the IM store

**Files:**
- Modify: `web/src/features/im/state/imStore.ts`
- Modify: `web/src/features/im/state/imStore.test.ts`

**Interfaces:**
- Produces: `showMessageSequenceNumbers: boolean`, `setShowMessageSequenceNumbers(show: boolean): void`, `toggleShowMessageSequenceNumbers(): void`, and exported `SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY`.

- [ ] Write failing tests that prove reset reads localStorage and toggling persists.
- [ ] Implement storage helpers and store actions.
- [ ] Run `cd web && pnpm test src/features/im/state/imStore.test.ts`.

### Task 2: Add shell settings popup

**Files:**
- Create: `web/src/features/shell/ShellSettingsMenu.tsx`
- Modify: `web/src/features/shell/DesktopRail.tsx`
- Modify: `web/src/features/shell/MobileFeatureBar.tsx`
- Modify: `web/src/features/shell/AppShell.test.tsx`
- Modify: `web/src/shared/i18n/resources.ts`

**Interfaces:**
- Consumes: IM store setting actions from Task 1.
- Produces: settings trigger labelled `Settings` / `设置`, popup labelled `Settings` / `设置`, and a switch labelled `Show message sequence numbers` / `显示消息序号`.

- [ ] Write failing shell tests for desktop and mobile placement.
- [ ] Implement `ShellSettingsMenu` with Escape/outside-click close behavior.
- [ ] Render it at the bottom of `DesktopRail` and inside `MobileFeatureBar`.
- [ ] Run `cd web && pnpm test src/features/shell/AppShell.test.tsx`.

### Task 3: Remove chat header sequence button

**Files:**
- Modify: `web/src/features/im/components/ChatView.tsx`
- Modify: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: `showMessageSequenceNumbers` from IM store.
- Produces: Chat header without the `# Seq` / `# 序号` button.

- [ ] Update ChatView test to toggle sequence numbers through the settings popup.
- [ ] Remove the local ChatView sequence state and header button.
- [ ] Pass `showMessageSequenceNumbers` from the IM store into `MessageList`.
- [ ] Run `cd web && pnpm test src/features/im/components/ChatView.test.tsx`.

### Task 4: Verification

- [ ] Run `cd web && pnpm test src/features/im/state/imStore.test.ts src/features/shell/AppShell.test.tsx src/features/im/components/ChatView.test.tsx`.
- [ ] Run `cd web && pnpm typecheck`.
- [ ] Run `cd web && pnpm lint`.
- [ ] Review the diff for only intended shell/settings/sequence-toggle changes.
