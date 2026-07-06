# Message Input Splitter Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Enter-to-send and multiline shortcuts while resizing the entire input panel by dragging the horizontal splitter between the message list and composer.

**Architecture:** `MessageInput` remains the owner of composer validation, submission, focus restoration, keyboard shortcuts, and current-page panel height state. It renders an accessible horizontal separator at its top edge and applies a clamped inline height to the form; `MessageList` continues to fill the remaining space through the existing flex-column layout.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS utility classes, i18next resource strings.

## Global Constraints

- Keep bare `Enter` as the send shortcut.
- `Shift+Enter` inserts a newline.
- `Ctrl+Enter` inserts a newline.
- Add a horizontal splitter at the top edge of the input panel, between the message list and the input panel.
- Dragging the splitter upward increases the input panel height and reduces the message list height.
- Dragging the splitter downward decreases the input panel height and increases the message list height.
- The chosen height is kept only in the current React page lifecycle; refresh or remount returns to the default height.
- Do not persist the height to localStorage or the backend.
- Disable native textarea resize so there is only one resizing affordance.
- Do not change message validation, send button behavior, disabled-state behavior, focus restoration, or realtime send payload shape.
- Run commands from `web/` with pnpm.

---

## File Structure

- Modify `web/src/features/im/components/ChatView.test.tsx`: keep multiline keyboard coverage, add splitter drag coverage, and assert the textarea no longer uses native resize.
- Modify `web/src/features/im/components/MessageInput.tsx`: add panel height state, pointer drag handlers, splitter markup, clamped height styling, and restore textarea `resize-none`.
- Modify `web/src/shared/i18n/resources.ts`: add English and Chinese accessible labels for the splitter.

---

### Task 1: Correct splitter resize regression tests

**Files:**
- Modify: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: existing `renderChatView`, `message`, `screen`, `waitFor`, `fireEvent`, and `vi` helpers/imports in `ChatView.test.tsx`.
- Produces: failing test expectations requiring a `role="separator"` handle named `Resize message input`, clamped form height updates on pointer drag, and textarea `resize-none` instead of `resize-y`.

- [ ] **Step 1: Strengthen the keyboard regression test**

In `web/src/features/im/components/ChatView.test.tsx`, inside the test named `sends with Enter and inserts newlines with Shift+Enter or Ctrl+Enter`, add the `sendCommand` assertion shown below immediately after the Ctrl+Enter value assertion:

```tsx
    await user.keyboard("{Control>}{Enter}{/Control}again");
    expect(composer).toHaveValue("hello\nworld\nagain");
    expect(sendCommand).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
```

- [ ] **Step 2: Replace the native textarea resize test with splitter drag coverage**

Replace the existing test named `allows vertical mouse resizing of the composer` with this test:

```tsx
  it("resizes the composer panel by dragging the horizontal splitter", async () => {
    await renderChatView();

    const resizeHandle = await screen.findByRole("separator", {
      name: "Resize message input",
    });
    const composerPanel = resizeHandle.closest("form");
    const composer = screen.getByRole("textbox", { name: "Message" });

    if (!composerPanel) {
      throw new Error("Resize handle should render inside the message input form");
    }

    expect(composerPanel).toHaveStyle({ height: "112px" });
    expect(composer).toHaveClass("resize-none");
    expect(composer).not.toHaveClass("resize-y");

    fireEvent.pointerDown(resizeHandle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle, { clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(resizeHandle, { clientY: 340, pointerId: 1 });

    expect(composerPanel).toHaveStyle({ height: "172px" });
  });
```

- [ ] **Step 3: Run the targeted tests and verify they fail for the expected reason**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: FAIL before implementation. The splitter test should fail because there is no `role="separator"` handle named `Resize message input`, and the current textarea still uses `resize-y` from the previous incorrect implementation.

- [ ] **Step 4: Commit the failing tests**

Do not commit if the targeted test suite passes before implementation.

```bash
git add web/src/features/im/components/ChatView.test.tsx
git commit -m "test: cover composer splitter resizing"
```

---

### Task 2: Splitter resize implementation

**Files:**
- Modify: `web/src/features/im/components/MessageInput.tsx`
- Modify: `web/src/shared/i18n/resources.ts`

**Interfaces:**
- Consumes: failing tests from Task 1.
- Produces: `MessageInput` with a current-lifecycle-only splitter-controlled form height, `Ctrl+Enter` newline behavior preserved, bare Enter send preserved, and textarea native resize disabled.

- [ ] **Step 1: Add splitter resource labels**

In `web/src/shared/i18n/resources.ts`, add the Chinese label inside the existing Chinese `messageInput` object after `retry`:

```ts
          retry: "重新发送",
          resizeHandle: "调整输入区高度",
```

Add the English label inside the existing English `messageInput` object after `retry`:

```ts
          retry: "Retry send",
          resizeHandle: "Resize message input",
```

- [ ] **Step 2: Add pointer event type, constants, and drag state type**

In `web/src/features/im/components/MessageInput.tsx`, change the React import to include `PointerEvent`:

```tsx
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
```

Add these constants and type after `VALIDATION_NOTICE_TIMEOUT_MS`:

```tsx
const DEFAULT_MESSAGE_INPUT_HEIGHT_PX = 112;
const MIN_MESSAGE_INPUT_HEIGHT_PX = 80;
const MAX_MESSAGE_INPUT_HEIGHT_PX = 280;

type ResizeDragState = {
  pointerId: number;
  startHeight: number;
  startY: number;
};
```

- [ ] **Step 3: Add height state and drag ref**

Inside `MessageInput`, after `const textareaRef = useRef<HTMLTextAreaElement | null>(null);`, add:

```tsx
  const resizeDragRef = useRef<ResizeDragState | null>(null);
```

After the existing `const [body, setBody] = useState("");`, add:

```tsx
  const [panelHeight, setPanelHeight] = useState(DEFAULT_MESSAGE_INPUT_HEIGHT_PX);
```

- [ ] **Step 4: Add splitter pointer handlers**

Add these functions after `showValidationNotice` and before `handleKeyDown`:

```tsx
  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startHeight: panelHeight,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    const resizeDrag = resizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    const nextHeight = resizeDrag.startHeight + resizeDrag.startY - event.clientY;
    setPanelHeight(clampMessageInputHeight(nextHeight));
  }

  function handleResizePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const resizeDrag = resizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    resizeDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
```

Add this helper function after the component, before `MessageInput`'s file end:

```tsx
function clampMessageInputHeight(height: number) {
  return Math.min(
    MAX_MESSAGE_INPUT_HEIGHT_PX,
    Math.max(MIN_MESSAGE_INPUT_HEIGHT_PX, height),
  );
}
```

- [ ] **Step 5: Replace the form opening markup with a fixed-height flex panel and splitter**

Change the `<form>` opening block from:

```tsx
    <form
      className="relative shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4"
      onSubmit={submitMessage}
    >
```

to:

```tsx
    <form
      className="relative flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)] px-3 pb-3 pt-4 md:px-5 md:pb-4 md:pt-5"
      onSubmit={submitMessage}
      style={{ height: `${panelHeight}px` }}
    >
      <div
        aria-label={t("im.messageInput.resizeHandle")}
        aria-orientation="horizontal"
        aria-valuemax={MAX_MESSAGE_INPUT_HEIGHT_PX}
        aria-valuemin={MIN_MESSAGE_INPUT_HEIGHT_PX}
        aria-valuenow={panelHeight}
        className="group absolute left-0 top-0 flex h-3 w-full -translate-y-1/2 cursor-row-resize touch-none items-center justify-center"
        onPointerCancel={handleResizePointerEnd}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        role="separator"
      >
        <span
          aria-hidden="true"
          className="h-1 w-12 rounded-full bg-[var(--border)] transition-colors group-hover:bg-[var(--accent)]"
        />
      </div>
```

- [ ] **Step 6: Make the composer row fill the panel and disable textarea native resize**

Change the row wrapper from:

```tsx
      <div className="flex items-end gap-2 md:gap-3">
```

to:

```tsx
      <div className="flex min-h-0 flex-1 items-end gap-2 md:gap-3">
```

Change the `Textarea` className from the previous incorrect native resize version:

```tsx
          className="max-h-40 min-h-10 flex-1 resize-y rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

to:

```tsx
          className="h-full min-h-10 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

- [ ] **Step 7: Run the targeted tests and verify they pass**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: PASS. The splitter test sees the default `112px` panel height, dragging from `clientY: 400` to `clientY: 340` increases panel height to `172px`, and the textarea has `resize-none` without `resize-y`.

- [ ] **Step 8: Run typecheck**

Run:

```bash
cd web && pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Commit the implementation**

```bash
git add web/src/features/im/components/MessageInput.tsx web/src/shared/i18n/resources.ts
git commit -m "feat: resize composer with horizontal splitter"
```

---

## Self-Review

- Spec coverage: Task 1 and Task 2 cover Enter send, Shift+Enter newline, Ctrl+Enter newline, a horizontal splitter between list and input panel, upward drag increasing input height, lifecycle-only React state, no localStorage/backend persistence, and disabled textarea native resize.
- Placeholder scan: no TBD/TODO/"similar to" placeholders remain.
- Type consistency: pointer handlers use `PointerEvent<HTMLDivElement>`, the drag state stores `pointerId`, `startHeight`, and `startY`, and tests query the translated English separator name `Resize message input`.
