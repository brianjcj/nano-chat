# Composer Button Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the message textarea on its own full-width row and move a smaller send button to a separate bottom-right action row.

**Architecture:** `MessageInput` remains the single composer component. The change is limited to its internal layout classes and focused tests in `ChatView.test.tsx`; splitter resize state, keyboard shortcuts, validation, disabled behavior, focus restoration, and send payload flow remain unchanged.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS utility classes.

## Global Constraints

- Keep the existing horizontal splitter resize behavior unchanged.
- Keep bare `Enter` as the send shortcut.
- `Shift+Enter` inserts a newline.
- `Ctrl+Enter` inserts a newline.
- `Alt+Enter` and `Meta+Enter` do not send.
- Move the send button out of the textarea row.
- Make the textarea occupy the full composer width with balanced left/right spacing.
- Place the send button on its own row at the bottom-right of the composer panel.
- Make the send button visually smaller than the current full-height row button.
- Preserve validation, disabled behavior, focus restoration, realtime payload shape, and the current-lifecycle-only panel height state.
- Run commands from `web/` with pnpm.

---

## File Structure

- Modify `web/src/features/im/components/ChatView.test.tsx`: add layout regression coverage for textarea/action-row separation and compact send button sizing.
- Modify `web/src/features/im/components/MessageInput.tsx`: switch composer contents from a horizontal row to a vertical stack with full-width textarea and bottom-right compact send button.

---

### Task 1: Composer layout regression test

**Files:**
- Modify: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: existing `renderChatView`, `screen`, and jest-dom class assertions in `ChatView.test.tsx`.
- Produces: a failing test requiring the textarea wrapper to be a vertical stack, the send button to be inside a separate right-aligned action row, and the send button to use compact sizing.

- [ ] **Step 1: Add the failing layout test**

Add this test immediately after `does not send with Alt+Enter or Meta+Enter`:

```tsx
  it("places a compact send button on a separate bottom-right row", async () => {
    await renderChatView();

    const composer = await screen.findByRole("textbox", { name: "Message" });
    const sendButton = screen.getByRole("button", { name: "Send" });
    const composerStack = composer.parentElement;
    const actionRow = sendButton.parentElement;

    if (!composerStack || !actionRow) {
      throw new Error("Message composer layout wrappers should exist");
    }

    expect(composerStack).toHaveClass("flex-col");
    expect(composerStack).toHaveClass("items-stretch");
    expect(actionRow).toHaveClass("justify-end");
    expect(actionRow).not.toBe(composerStack);
    expect(sendButton).toHaveClass("h-8");
    expect(sendButton).toHaveClass("text-xs");
    expect(sendButton).not.toHaveClass("h-10");
  });
```

- [ ] **Step 2: Run the targeted tests and verify the new test fails before implementation**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: FAIL before implementation. The new test should fail because the current composer wrapper is a horizontal row without `flex-col`, the send button shares the same parent as the textarea, and the send button still uses `h-10` rather than `h-8 text-xs`.

- [ ] **Step 3: Commit the failing test**

Do not commit if the targeted test suite passes before implementation.

```bash
git add web/src/features/im/components/ChatView.test.tsx
git commit -m "test: cover composer send button layout"
```

---

### Task 2: Composer layout implementation

**Files:**
- Modify: `web/src/features/im/components/MessageInput.tsx`

**Interfaces:**
- Consumes: failing test from Task 1.
- Produces: `MessageInput` layout where the textarea fills a top row and the compact send button sits in a separate bottom-right action row.

- [ ] **Step 1: Replace the horizontal row wrapper with a vertical stack**

In `MessageInput.tsx`, replace:

```tsx
      <div className="flex min-h-0 flex-1 items-end gap-2 md:gap-3">
```

with:

```tsx
      <div className="flex min-h-0 flex-1 flex-col items-stretch gap-2">
```

- [ ] **Step 2: Keep the textarea full-width in the stack**

Keep the existing textarea in the stack and change its className from:

```tsx
          className="h-full min-h-10 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

to:

```tsx
          className="min-h-0 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

- [ ] **Step 3: Move the send button into its own bottom-right action row**

Wrap the existing `<Button ...>` in this action row:

```tsx
        <div className="flex shrink-0 justify-end">
          <Button
            aria-label={t("im.messageInput.send")}
            className="h-8 rounded-[calc(var(--radius)*0.55)] px-2.5 text-xs md:px-3"
            disabled={disabled || isSending}
            type="submit"
          >
            <SendHorizontal aria-hidden="true" className="size-3.5" />
            <span className="hidden sm:inline">{t("im.messageInput.send")}</span>
          </Button>
        </div>
```

The final structure inside the stack should be:

```tsx
      <div className="flex min-h-0 flex-1 flex-col items-stretch gap-2">
        <Textarea ... />
        <div className="flex shrink-0 justify-end">
          <Button ...>...</Button>
        </div>
      </div>
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: PASS. Existing keyboard, splitter, disabled composer, and the new layout test all pass.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd web && pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add web/src/features/im/components/MessageInput.tsx
git commit -m "feat: move composer send button below input"
```

---

## Self-Review

- Spec coverage: Task 1 and Task 2 cover separate button row, bottom-right alignment, compact send button sizing, full-width textarea, and preserving existing behavior by re-running the focused ChatView suite.
- Placeholder scan: no TBD/TODO/"similar to" placeholders remain.
- Type consistency: tests use existing Testing Library queries and class assertions; implementation keeps existing `MessageInput` props and handlers unchanged.
