# Composer Compact Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composer denser: smaller send button, tighter spacing/padding, and a 3-row default textarea.

**Architecture:** Keep the change inside `MessageInput` and its existing ChatView integration tests. The splitter, keyboard behavior, validation, disabled behavior, focus restoration, payload shape, and lifecycle-only height state stay unchanged.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS utility classes.

## Global Constraints

- Keep the existing splitter resize behavior unchanged.
- Keep bare `Enter` as the send shortcut.
- `Shift+Enter` inserts a newline.
- `Ctrl+Enter` inserts a newline.
- `Alt+Enter` and `Meta+Enter` do not send.
- Make the send button smaller than the current compact button.
- Reduce composer panel padding and the gap between the textarea and action row.
- Reduce textarea internal padding slightly.
- Make the textarea default to 3 rows.
- Increase the default composer panel height enough for the 3-row textarea plus the smaller action row.
- Preserve validation, disabled behavior, focus restoration, realtime payload shape, and current-lifecycle-only panel height state.
- Run commands from `web/` with pnpm.

---

## File Structure

- Modify `web/src/features/im/components/ChatView.test.tsx`: update/add class and height expectations for the denser 3-row composer.
- Modify `web/src/features/im/components/MessageInput.tsx`: update default height, padding/gap classes, textarea rows/padding, and button compact classes.

---

### Task 1: Compact composer tests and implementation

**Files:**
- Modify: `web/src/features/im/components/ChatView.test.tsx`
- Modify: `web/src/features/im/components/MessageInput.tsx`

**Interfaces:**
- Consumes: existing `MessageInput` props and existing `ChatView.test.tsx` test helpers.
- Produces: a compact composer with `DEFAULT_MESSAGE_INPUT_HEIGHT_PX = 152`, textarea `rows={3}`, tighter spacing, and a smaller `h-7` send button.

- [ ] **Step 1: Write failing tests**

Update existing expectations in `web/src/features/im/components/ChatView.test.tsx`:

- In `places a compact send button on a separate bottom-right row`, add assertions that the form uses tighter padding, the stack uses `gap-1.5`, the textarea has `rows="3"`, `px-2.5`, and `py-2`, and the button uses `h-7`, `px-2`, and `text-[0.7rem]` instead of `h-8`.
- In splitter tests, update default-height expectations from `112px` to `152px`; update upward pointer drag result from `172px` to `212px`; update ArrowUp/ArrowDown expectations from `120px`/`112px` to `160px`/`152px`; keep Home at `80px` and End at `280px`.
- In the dissolved composer test, update initial height/aria-valuenow to `152`, keep aria-valuemin `128`, and keep the downward drag clamp expectation at `128px`.

- [ ] **Step 2: Verify RED**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: FAIL before implementation because the composer still has default height `112px`, textarea `rows="1"`, larger padding/gap, and `h-8` button sizing.

- [ ] **Step 3: Implement compact spacing**

In `web/src/features/im/components/MessageInput.tsx`:

- Change `DEFAULT_MESSAGE_INPUT_HEIGHT_PX` from `112` to `152`.
- Change the form classes from `px-3 pb-3 pt-4 md:px-5 md:pb-4 md:pt-5` to `px-2 pb-2 pt-3 md:px-4 md:pb-3 md:pt-4`.
- Change the composer stack gap from `gap-2` to `gap-1.5`.
- Change textarea classes from `px-3 py-2.5` to `px-2.5 py-2`.
- Change textarea `rows={1}` to `rows={3}`.
- Change send button classes from `h-8 rounded-[calc(var(--radius)*0.55)] px-2.5 text-xs md:px-3` to `h-7 rounded-[calc(var(--radius)*0.5)] px-2 text-[0.7rem] md:px-2.5`.
- Change send icon class from `size-3.5` to `size-3`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
cd web && pnpm typecheck
```

Expected: PASS for both commands.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/im/components/ChatView.test.tsx web/src/features/im/components/MessageInput.tsx
git commit -m "feat: tighten composer spacing"
```

---

## Self-Review

- Spec coverage: tests and implementation cover smaller send button, tighter parent/input spacing, default 3-row textarea, updated default panel height, and preservation of existing behavior through the ChatView suite.
- Placeholder scan: no TBD/TODO/"similar to" placeholders remain.
- Type consistency: no public interfaces change.
