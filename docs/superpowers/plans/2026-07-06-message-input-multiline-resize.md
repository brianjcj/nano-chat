# Message Input Multiline Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Enter-to-send while supporting Shift+Enter and Ctrl+Enter newlines, and allow mouse vertical resizing of the chat composer.

**Architecture:** `MessageInput` remains the single composer component and continues to own validation, submission, disabled state, and focus restoration. The change is limited to keyboard shortcut branching and textarea sizing classes, with tests in `ChatView.test.tsx` covering integrated composer behavior.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS utility classes.

## Global Constraints

- Keep bare `Enter` as the send shortcut.
- `Shift+Enter` inserts a newline.
- `Ctrl+Enter` inserts a newline.
- Users can resize the message textarea vertically with the mouse.
- Do not change message validation, send button behavior, disabled-state behavior, or realtime send payload shape.
- Run commands from `web/` with pnpm.

---

## File Structure

- Modify `web/src/features/im/components/ChatView.test.tsx`: add regression coverage for Ctrl+Enter newline behavior and the resize class exposed by the composer.
- Modify `web/src/features/im/components/MessageInput.tsx`: remove auto-height behavior, allow vertical resize, and treat Ctrl+Enter like Shift+Enter.

---

### Task 1: Composer regression tests

**Files:**
- Modify: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: existing `renderChatView`, `message`, `screen`, `waitFor`, and `vi` helpers/imports in `ChatView.test.tsx`.
- Produces: failing test expectations that require `MessageInput` to expose `resize-y` and to leave Ctrl+Enter as textarea newline input.

- [ ] **Step 1: Update the existing newline/send test and add resize coverage**

Replace the existing test beginning with:

```tsx
  it("sends with Enter and inserts a newline with Shift+Enter", async () => {
```

through its closing `});` with this block:

```tsx
  it("sends with Enter and inserts newlines with Shift+Enter or Ctrl+Enter", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      conversation_id: "conversation-1",
      message: message(1, "hello\nworld\nagain"),
    });
    const { user } = await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.click(composer);
    await user.keyboard("hello{Shift>}{Enter}{/Shift}world");
    expect(composer).toHaveValue("hello\nworld");

    await user.keyboard("{Control>}{Enter}{/Control}again");
    expect(composer).toHaveValue("hello\nworld\nagain");

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "message.send",
        expect.objectContaining({ body: "hello\nworld\nagain" }),
      );
    });
  });
```

Add this test immediately after the newline/send test:

```tsx
  it("allows vertical mouse resizing of the composer", async () => {
    await renderChatView();

    const composer = await screen.findByRole("textbox", { name: "Message" });

    expect(composer).toHaveClass("resize-y");
    expect(composer).not.toHaveClass("resize-none");
  });
```

- [ ] **Step 2: Run the targeted tests and verify they fail for the expected reasons**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: FAIL before implementation. The Ctrl+Enter assertion should fail because Ctrl+Enter currently submits instead of inserting a newline, and the resize assertion should fail because the composer currently has `resize-none` instead of `resize-y`.

- [ ] **Step 3: Commit the failing tests**

Do not commit if the tests pass before implementation; that means the test is not proving the requested behavior.

```bash
git add web/src/features/im/components/ChatView.test.tsx
git commit -m "test: cover multiline composer resize behavior"
```

---

### Task 2: MessageInput behavior and styling

**Files:**
- Modify: `web/src/features/im/components/MessageInput.tsx`

**Interfaces:**
- Consumes: failing tests from Task 1.
- Produces: `MessageInput` where bare Enter sends, Shift+Enter and Ctrl+Enter insert newlines, and the textarea uses vertical mouse resizing.

- [ ] **Step 1: Remove only the body-driven auto-height effect**

Keep the existing React import unchanged because `useEffect` is still needed for the validation notice timeout:

```tsx
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
```

Remove only this body-driven auto-height effect from `MessageInput`:

```tsx
  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [body]);
```

- [ ] **Step 2: Update Enter key branching**

Replace `handleKeyDown` with:

```tsx
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }
```

- [ ] **Step 3: Enable vertical resize on the composer textarea**

Change the `Textarea` className from:

```tsx
          className="max-h-40 min-h-10 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

to:

```tsx
          className="max-h-40 min-h-10 flex-1 resize-y rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: PASS. The updated newline/send test sends a single `message.send` payload with body `hello\nworld\nagain`, and the resize test sees `resize-y` without `resize-none`.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd web && pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add web/src/features/im/components/MessageInput.tsx
git commit -m "feat: support multiline resizable composer"
```

---

## Self-Review

- Spec coverage: Task 1 tests and Task 2 implementation cover bare Enter send, Shift+Enter newline, Ctrl+Enter newline, and vertical mouse resizing.
- Placeholder scan: no TBD/TODO/"similar to" placeholders remain.
- Type consistency: only existing component props and Testing Library APIs are used; `KeyboardEvent<HTMLTextAreaElement>` remains unchanged.
