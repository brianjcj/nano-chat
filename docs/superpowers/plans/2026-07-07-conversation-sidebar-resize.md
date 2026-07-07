# Conversation Sidebar Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop conversation-list sidebar drag handle that resizes the sidebar and persists the chosen width to `localStorage`.

**Architecture:** Keep the resize behavior inside `AppShell.tsx`, because the sidebar width belongs to the shell layout rather than the conversation-list content. Use a CSS custom property so desktop can consume the stateful width via a `md:` Tailwind width class while mobile retains the existing full-width panel behavior. Keep copy in the existing i18n resource file.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 utility classes, Vitest, Testing Library, i18next.

## Global Constraints

- Add mouse/pointer drag resizing for the conversation list sidebar.
- The resize affordance appears on the right edge of the conversation list sidebar, between the sidebar and main chat workspace.
- Resizing applies only to desktop layouts (`md` and wider). Mobile behavior stays unchanged: the conversation list remains the active full-width panel when selected.
- Keep the current desktop width as the default: `23rem` / `368px`.
- Clamp the width to a usable range: `18rem` / `288px` minimum and `34rem` / `544px` maximum.
- Persist the chosen width in `localStorage` under `nano-chat:conversation-sidebar-width`.
- Restore the persisted width on page load/remount when the stored value is valid.
- Ignore invalid, missing, or out-of-range stored values and fall back to the default width.
- Persistence is best-effort: blocked storage reads/writes must not break rendering or resizing.
- Use TDD: write the failing tests first, verify they fail for the missing feature, then implement.

---

## File Structure

- Modify `web/src/features/shell/AppShell.tsx`: own the sidebar width state, localStorage helpers, pointer/keyboard resize handlers, CSS custom property, and desktop-only separator handle.
- Modify `web/src/shared/i18n/resources.ts`: add the resize-handle accessible label for English and Chinese.
- Modify `web/src/features/shell/AppShell.test.tsx`: add tests for default width, pointer resize persistence, persisted restore/fallback, and keyboard accessibility.

---

### Task 1: Resizable persisted conversation sidebar

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/shared/i18n/resources.ts`
- Test: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: Existing `AppShell` shell layout, existing `ConversationList` region label, existing localStorage best-effort pattern used in `web/src/features/im/state/imStore.ts`.
- Produces: `CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY = "nano-chat:conversation-sidebar-width"`; a desktop-only separator with accessible label `t("im.conversationList.resizeHandle")`; sidebar CSS variable `--conversation-sidebar-width`; localStorage value containing the clamped width as a base-10 string.

- [ ] **Step 1: Write the failing tests**

Update the first import in `web/src/features/shell/AppShell.test.tsx` to include `fireEvent`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
```

Add this test-local constant after `vi.mock(...)`:

```tsx
const CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY =
  "nano-chat:conversation-sidebar-width";
```

Add the following tests inside `describe("AppShell", () => { ... })`, after the existing `"bounds the shell height and scrolls only the conversation list body"` test and before the mobile feature bar test:

```tsx
  it("starts the desktop conversation sidebar at the default width and exposes a resize separator", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize conversation list",
    });

    expect(listPanel).toHaveClass(
      "relative",
      "md:w-[var(--conversation-sidebar-width)]",
    );
    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 368px");
    expect(resizeHandle).toHaveClass("hidden", "md:flex");
    expect(resizeHandle).toHaveAttribute("aria-orientation", "vertical");
    expect(resizeHandle).toHaveAttribute("aria-valuemin", "288");
    expect(resizeHandle).toHaveAttribute("aria-valuemax", "544");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "368");
  });

  it("resizes the desktop conversation sidebar by dragging the vertical separator and persists the width", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize conversation list",
    });

    fireEvent.pointerDown(resizeHandle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(resizeHandle, { clientX: 360, pointerId: 1 });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 428px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "428");
    expect(
      window.localStorage.getItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY),
    ).toBe("428");
  });

  it("restores a valid persisted conversation sidebar width on remount", async () => {
    window.localStorage.setItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY, "456");

    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize conversation list",
    });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 456px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "456");
  });

  it("falls back to the default sidebar width for invalid persisted values", async () => {
    window.localStorage.setItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY, "120");

    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize conversation list",
    });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 368px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "368");
  });

  it("resizes the focused conversation sidebar separator with keyboard controls", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize conversation list",
    });

    expect(resizeHandle).toHaveAttribute("tabindex", "0");
    resizeHandle.focus();
    expect(resizeHandle).toHaveFocus();

    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 376px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "376");
    expect(
      window.localStorage.getItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY),
    ).toBe("376");

    fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 368px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "368");

    fireEvent.keyDown(resizeHandle, { key: "End" });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 544px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "544");

    fireEvent.keyDown(resizeHandle, { key: "Home" });

    expect(listPanel).toHaveStyle("--conversation-sidebar-width: 288px");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "288");
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run from the web directory:

```bash
cd web && pnpm test src/features/shell/AppShell.test.tsx
```

Expected: FAIL because the separator named `Resize conversation list` does not exist yet and the sidebar still uses `md:w-[23rem]`.

- [ ] **Step 3: Implement the resize state, helpers, and handle**

In `web/src/features/shell/AppShell.tsx`, change the React import to:

```tsx
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
```

Add these constants and types after `BANNER_STATUSES`:

```tsx
export const CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY =
  "nano-chat:conversation-sidebar-width";

const DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX = 368;
const MIN_CONVERSATION_SIDEBAR_WIDTH_PX = 288;
const MAX_CONVERSATION_SIDEBAR_WIDTH_PX = 544;
const CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX = 8;

type SidebarResizeDragState = {
  pointerId: number;
  startWidth: number;
  startX: number;
};
```

Inside `AppShell`, after the store selectors, add state, refs, and handlers:

```tsx
  const sidebarResizeDragRef = useRef<SidebarResizeDragState | null>(null);
  const [conversationSidebarWidth, setConversationSidebarWidth] = useState(
    readConversationSidebarWidth,
  );

  function setAndPersistConversationSidebarWidth(nextWidth: number) {
    const clampedWidth = clampConversationSidebarWidth(nextWidth);
    setConversationSidebarWidth(clampedWidth);
    writeConversationSidebarWidth(clampedWidth);
  }

  function handleConversationSidebarResizePointerDown(
    event: PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    sidebarResizeDragRef.current = {
      pointerId: event.pointerId,
      startWidth: conversationSidebarWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleConversationSidebarResizePointerMove(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const resizeDrag = sidebarResizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    setAndPersistConversationSidebarWidth(
      resizeDrag.startWidth + event.clientX - resizeDrag.startX,
    );
  }

  function handleConversationSidebarResizePointerEnd(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const resizeDrag = sidebarResizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    sidebarResizeDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleConversationSidebarResizeKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") {
      nextWidth =
        conversationSidebarWidth - CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX;
    } else if (event.key === "ArrowRight") {
      nextWidth =
        conversationSidebarWidth + CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX;
    } else if (event.key === "Home") {
      nextWidth = MIN_CONVERSATION_SIDEBAR_WIDTH_PX;
    } else if (event.key === "End") {
      nextWidth = MAX_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    setAndPersistConversationSidebarWidth(nextWidth);
  }
```

Change the `<aside>` in `AppShell` to this structure:

```tsx
          <aside
            className={cn(
              "relative h-full min-h-0 min-w-0 flex-1 flex-col border-r border-[var(--border)] bg-[var(--surface)] pb-20 md:flex md:w-[var(--conversation-sidebar-width)] md:max-w-none md:flex-none md:pb-0",
              mobilePanel === "conversations" ? "flex" : "hidden md:flex",
            )}
            style={
              {
                "--conversation-sidebar-width": `${conversationSidebarWidth}px`,
              } as CSSProperties
            }
          >
            <ConversationList />
            <div
              aria-label={t("im.conversationList.resizeHandle")}
              aria-orientation="vertical"
              aria-valuemax={MAX_CONVERSATION_SIDEBAR_WIDTH_PX}
              aria-valuemin={MIN_CONVERSATION_SIDEBAR_WIDTH_PX}
              aria-valuenow={conversationSidebarWidth}
              className="group absolute right-0 top-0 hidden h-full w-3 translate-x-1/2 cursor-col-resize touch-none items-center justify-center md:flex"
              onKeyDown={handleConversationSidebarResizeKeyDown}
              onPointerCancel={handleConversationSidebarResizePointerEnd}
              onPointerDown={handleConversationSidebarResizePointerDown}
              onPointerMove={handleConversationSidebarResizePointerMove}
              onPointerUp={handleConversationSidebarResizePointerEnd}
              role="separator"
              tabIndex={0}
            >
              <span
                aria-hidden="true"
                className="h-12 w-1 rounded-full bg-[var(--border)] transition-colors group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)]"
              />
            </div>
          </aside>
```

Add these helper functions near the bottom of `AppShell.tsx`, before `function EmptyWorkspace()`:

```tsx
function readConversationSidebarWidth() {
  try {
    const storedWidth = globalThis.localStorage?.getItem(
      CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY,
    );

    if (!storedWidth) {
      return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    const parsedWidth = Number(storedWidth);

    if (
      !Number.isFinite(parsedWidth) ||
      parsedWidth < MIN_CONVERSATION_SIDEBAR_WIDTH_PX ||
      parsedWidth > MAX_CONVERSATION_SIDEBAR_WIDTH_PX
    ) {
      return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    return parsedWidth;
  } catch {
    return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
  }
}

function writeConversationSidebarWidth(width: number) {
  try {
    globalThis.localStorage?.setItem(
      CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY,
      String(width),
    );
  } catch {
    // Sidebar width persistence is best-effort when storage is unavailable.
  }
}

function clampConversationSidebarWidth(width: number) {
  return Math.min(
    MAX_CONVERSATION_SIDEBAR_WIDTH_PX,
    Math.max(MIN_CONVERSATION_SIDEBAR_WIDTH_PX, Math.round(width)),
  );
}
```

- [ ] **Step 4: Add i18n labels**

In `web/src/shared/i18n/resources.ts`, add the Chinese label inside the first `im.conversationList` object, after `region: "会话列表",`:

```ts
          resizeHandle: "调整会话列表宽度",
```

Add the English label inside the second `im.conversationList` object, after `region: "Conversation list",`:

```ts
          resizeHandle: "Resize conversation list",
```

- [ ] **Step 5: Run tests to verify GREEN**

Run from the web directory:

```bash
cd web && pnpm test src/features/shell/AppShell.test.tsx
```

Expected: PASS for `AppShell.test.tsx`.

- [ ] **Step 6: Run typecheck and lint**

Run from the web directory:

```bash
cd web && pnpm typecheck && pnpm lint
```

Expected: both commands exit 0 with no TypeScript or ESLint errors.

- [ ] **Step 7: Self-review and commit**

Review the diff:

```bash
git diff -- web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx web/src/shared/i18n/resources.ts
```

Confirm:

- Tests were added before implementation and failed for the missing resize handle.
- The handle is desktop-visible only with `hidden md:flex`.
- Mobile width is not controlled by inline `width`; desktop uses `md:w-[var(--conversation-sidebar-width)]`.
- Pointer drag right increases width and clamps through `clampConversationSidebarWidth`.
- Keyboard controls use ArrowLeft, ArrowRight, Home, and End.
- Invalid persisted values fall back to `368px` instead of clamping.
- Storage write failures are caught.

Commit:

```bash
git add web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx web/src/shared/i18n/resources.ts
git commit -m "feat: resize conversation sidebar"
```
