# WeChat-style Chat Main UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the authenticated Nano Chat main UI into a WeChat-inspired IM client layout and interaction model without changing the product palette or authentication pages.

**Architecture:** Keep the existing shell and IM component boundaries. `AppShell` controls desktop/mobile panel layout, `ConversationList` remains the roster, `ChatView` remains the loaded conversation container, `MessageList` remains scroll/message rendering, and `MessageInput` remains the composer. Changes are primarily layout classes, panel visibility rules, and small presentational helpers for incoming avatars.

**Tech Stack:** React 19, React Router 7, Zustand, TanStack Query, TypeScript, Tailwind CSS 4 utility classes, Vitest, Testing Library.

## Global Constraints

- Authenticated chat main UI only.
- Do not modify login or registration pages.
- Do not add backend API behavior.
- Do not add QR-code login, contacts modules, payments, moments, or other WeChat feature areas.
- Do not exact-match WeChat colors; keep Nano Chat's existing visual palette.
- Preserve existing data flow through `useImStore`, React Router, `useConversationsQuery`, `useConversationMessages`, and `useSendMessage`.
- Preserve existing loading, error, empty, disabled/dissolved conversation, validation, failed retry, and realtime connection states.
- Keep existing accessibility labels and roles unless a task explicitly adds a more specific presentational label.
- Protect existing uncommitted work: run `git status --short` before each task, avoid reverting unrelated edits, and stage only hunks created for the task.
- Because this worktree already has pre-existing modified files, skip task commits if staging only this task's hunks cannot be done safely; report the skipped commit and changed files instead.

---

## File Structure

- `web/src/features/shell/AppShell.tsx`
  - Owns full-height desktop/mobile shell layout, conversation/chat panel visibility, mobile back control, empty workspace, and connection banner placement.
- `web/src/features/shell/DesktopRail.tsx`
  - Owns the desktop feature rail visual density and stable client rail treatment.
- `web/src/features/shell/MobileFeatureBar.tsx`
  - Owns the mobile bottom feature bar; it must disappear while the chat panel is active.
- `web/src/features/im/components/ConversationList.tsx`
  - Owns the IM conversation roster, compact header actions, row density, selected row state, unread/time presentation, and list states.
- `web/src/features/im/components/ChatView.tsx`
  - Owns the loaded chat workspace structure: fixed header, message viewport, fixed composer, group member panel trigger.
- `web/src/features/im/components/MessageList.tsx`
  - Owns the independent message scroller, timestamp rows, call-event rows, back-to-bottom control, incoming sender avatar, and bubble styling.
- `web/src/features/im/components/MessageInput.tsx`
  - Owns the compact fixed composer form and send behavior.
- `web/src/styles.css`
  - Optional minor global background/token support only; no palette rewrite.
- Tests remain beside the changed components:
  - `web/src/features/shell/AppShell.test.tsx`
  - `web/src/features/im/components/ConversationList.test.tsx`
  - `web/src/features/im/components/ChatView.test.tsx`
  - `web/src/features/im/components/MessageList.test.tsx`

---

### Task 1: Shell Client Frame and Mobile Feature Bar Visibility

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/shell/DesktopRail.tsx`
- Modify: `web/src/features/shell/MobileFeatureBar.tsx`
- Test: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `useImStore((state) => state.mobilePanel)` where `mobilePanel` is `"conversations" | "chat"`.
- Consumes: existing `Workspace({ conversationId }: { conversationId: string | null })` route behavior.
- Produces: `MobileFeatureBar` returns `null` whenever `mobilePanel === "chat"` so the composer owns the mobile bottom edge.
- Produces: shell DOM still exposes `aria-label="Feature rail"`, `aria-label="Conversation list"`, and `role="main" name="Main workspace"`.

- [ ] **Step 1: Capture current worktree state**

Run:

```bash
git status --short
```

Expected: Shows the pre-existing dirty files. Do not revert them.

- [ ] **Step 2: Add a failing mobile feature bar visibility test**

Append this test inside `describe("AppShell", () => { ... })` in `web/src/features/shell/AppShell.test.tsx` after the existing mobile feature bar test:

```tsx
  it("hides the mobile feature bar while the chat panel is active", async () => {
    const remoteUser: UserSummary = {
      user_id: "1002",
      username: "bob",
      display_name: "Bob",
    };
    const conversation: ConversationSummary = {
      conversation_id: "conversation-1",
      type: "direct",
      name: null,
      state: "active",
      latest_message_seq: 1,
      read_seq: 1,
      unread_count: 0,
      active_member_count: 2,
      direct_user: remoteUser,
      latest_message: null,
    };
    const listConversations = vi.fn().mockResolvedValue([conversation]);
    const listMessages = vi.fn().mockResolvedValue([]);

    await renderAppRoute({
      initialEntries: ["/app/im/conversations/conversation-1"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient({ listConversations, listMessages }),
    });

    expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText("Mobile feature bar")).not.toBeInTheDocument();
    });
    expect(useImStore.getState().mobilePanel).toBe("chat");
  });
```

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
cd web && pnpm vitest run src/features/shell/AppShell.test.tsx --testNamePattern "hides the mobile feature bar"
```

Expected: FAIL because `MobileFeatureBar` still renders while `mobilePanel` is `"chat"`.

- [ ] **Step 4: Hide the mobile feature bar while chatting**

In `web/src/features/shell/MobileFeatureBar.tsx`, add a `mobilePanel` selector after the existing store selectors and return `null` before rendering the `<nav>`:

```tsx
  const mobilePanel = useImStore((state) => state.mobilePanel);

  if (mobilePanel === "chat") {
    return null;
  }
```

Keep the existing `aria-label={t("shell.mobileFeatureBar")}` on the `<nav>` so `/app/im` tests continue to find it.

- [ ] **Step 5: Reshape `AppShell` into a full-height client frame**

In `web/src/features/shell/AppShell.tsx`, update only classes/structure, preserving behavior:

1. Replace the outer root and decorative overlay with a quiet full-height frame:

```tsx
    <div className="h-dvh min-h-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex h-full min-h-0 bg-[var(--surface-muted)]">
```

2. Keep `<DesktopRail />` as the first child.

3. Use this class set for the conversation `<aside>`:

```tsx
              "h-full min-h-0 min-w-0 flex-1 flex-col border-r border-[var(--border)] bg-[var(--surface)] pb-20 md:flex md:w-[23rem] md:max-w-none md:flex-none md:pb-0",
```

4. Use this class set for the `<main>`:

```tsx
              "h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface-muted)] md:flex",
```

5. In `Workspace`, replace the section class with:

```tsx
    <section className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-muted)]">
```

6. Replace the mobile back row classes with:

```tsx
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 md:hidden">
```

7. Replace the mobile back button classes with:

```tsx
            className="inline-flex h-10 items-center gap-2 rounded-[calc(var(--radius)*0.65)] px-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
```

8. Replace the workspace content wrapper class with:

```tsx
      <div className="flex min-h-0 flex-1 items-stretch justify-stretch">
```

- [ ] **Step 6: Make the empty workspace quiet and client-like**

In `EmptyWorkspace` in `web/src/features/shell/AppShell.tsx`, replace the root container classes with:

```tsx
    <div className="flex h-full w-full items-center justify-center bg-[var(--surface-muted)] p-8 text-center">
```

Replace the inner content with a simple centered stack using existing translations:

```tsx
      <div className="max-w-md">
        {workspaceNotice ? (
          <p
            className="mb-5 rounded-[calc(var(--radius)*0.75)] border border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_9%,white)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]"
            role="status"
          >
            {t(`im.notices.${workspaceNotice.type}`)}
          </p>
        ) : null}
        <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[calc(var(--radius)*0.9)] bg-[var(--surface)] text-[var(--muted-foreground)] shadow-sm ring-1 ring-[var(--border)]">
          <MessageCircleHeart aria-hidden="true" className="size-8" />
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
          {t("shell.placeholder.emptyTitle")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          {t("shell.placeholder.emptyDescription")}
        </p>
      </div>
```

Remove the old absolute gradient blobs from `EmptyWorkspace`.

- [ ] **Step 7: Make the desktop rail feel like a stable client rail**

In `web/src/features/shell/DesktopRail.tsx`, replace the `<aside>` className with:

```tsx
      className="hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-[color-mix(in_oklab,var(--foreground)_24%,transparent)] bg-[color-mix(in_oklab,var(--foreground)_94%,#3d2c32)] px-2.5 py-4 text-white md:flex"
```

Replace the `NavLink` class base with:

```tsx
              "flex size-11 items-center justify-center rounded-[calc(var(--radius)*0.7)] text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white",
```

Replace the active class with:

```tsx
                "bg-white text-[var(--foreground)] shadow-sm hover:bg-white hover:text-[var(--foreground)]",
```

- [ ] **Step 8: Run targeted shell tests**

Run:

```bash
cd web && pnpm vitest run src/features/shell/AppShell.test.tsx
```

Expected: PASS. If class assertions in existing tests fail because the shell frame intentionally changed, update only those expected class tokens to the new exact classes from this task.

- [ ] **Step 9: Commit or safely skip commit**

If `git status --short` shows no pre-existing modifications in the files touched by this task before your changes, run:

```bash
git add web/src/features/shell/AppShell.tsx web/src/features/shell/DesktopRail.tsx web/src/features/shell/MobileFeatureBar.tsx web/src/features/shell/AppShell.test.tsx
git commit -m "feat: reshape chat shell client frame"
```

If those files had pre-existing modifications, do not commit. Instead report:

```text
Skipped commit for Task 1 because target files had pre-existing modifications. Changed files: web/src/features/shell/AppShell.tsx, web/src/features/shell/DesktopRail.tsx, web/src/features/shell/MobileFeatureBar.tsx, web/src/features/shell/AppShell.test.tsx.
```

---

### Task 2: IM-style Conversation Roster

**Files:**
- Modify: `web/src/features/im/components/ConversationList.tsx`
- Test: `web/src/features/im/components/ConversationList.test.tsx`

**Interfaces:**
- Consumes: existing `ConversationSummary`, `getAvatarVisual`, `formatConversationListTime`, and `selectConversation(conversationId: string)` behavior.
- Produces: selected conversation rows still set `aria-current="page"` and call `navigate(`/app/im/conversations/${encodeURIComponent(conversationId)}`)`.
- Produces: existing dialogs still open from `setIsNewDirectOpen(true)` and `setIsCreateGroupOpen(true)`.

- [ ] **Step 1: Capture current worktree state**

Run:

```bash
git status --short
```

Expected: Shows any pre-existing dirty files. Do not revert them.

- [ ] **Step 2: Add a failing dense-row test**

Append this test inside `describe("ConversationList", () => { ... })` after the first render test:

```tsx
  it("renders conversations as dense client rows instead of floating cards", async () => {
    await renderConversationList({
      initialEntries: ["/app/im/conversations/direct-1"],
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 2,
          direct_user: directUser,
          latest_message: {
            message_id: "message-direct-1",
            message_seq: 8,
            sender: directUser,
            body: "Hey from Alice",
            created_at: "2026-06-14T00:01:00.000Z",
          },
        }),
      ],
    });

    const row = (await screen.findByText("Alice A.")).closest("button");

    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).toHaveClass("rounded-none", "border-b", "shadow-none");
    expect(row).not.toHaveClass("hover:-translate-y-0.5");
  });
```

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ConversationList.test.tsx --testNamePattern "dense client rows"
```

Expected: FAIL because current rows are rounded floating cards with hover translation/shadow.

- [ ] **Step 4: Convert the conversation list container and header to a client roster**

In `web/src/features/im/components/ConversationList.tsx`:

1. Replace the root section className with:

```tsx
      className="flex h-full min-h-0 flex-1 flex-col bg-[var(--surface)]"
```

2. Replace the `<header>` className with:

```tsx
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 md:px-5">
```

3. Replace the header top block with a compact title/actions layout:

```tsx
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              {t("shell.im")}
            </p>
            <h1 className="truncate text-xl font-bold tracking-tight">
              {t("im.conversationList.title")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-label={t("im.conversationList.newDirect")}
              className="inline-flex size-9 items-center justify-center rounded-[calc(var(--radius)*0.6)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
              onClick={() => setIsNewDirectOpen(true)}
              title={t("im.conversationList.newDirect")}
              type="button"
            >
              <UserPlus aria-hidden="true" className="size-4" />
            </button>
            <button
              aria-label={t("im.conversationList.createGroup")}
              className="inline-flex size-9 items-center justify-center rounded-[calc(var(--radius)*0.6)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
              onClick={() => setIsCreateGroupOpen(true)}
              title={t("im.conversationList.createGroup")}
              type="button"
            >
              <UsersRound aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          {t("im.conversationList.subtitle")}
        </p>
```

4. Remove the old large icon block and two-column action grid.

- [ ] **Step 5: Convert the list body and rows to dense IM rows**

In the list body:

1. Replace the scroll body className with:

```tsx
      <div className="min-h-0 flex-1 overflow-y-auto">
```

2. Replace `<ul className="space-y-2">` with:

```tsx
          <ul className="divide-y divide-[var(--border)]">
```

3. Replace the conversation row button className expression with:

```tsx
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-none border-b border-transparent px-4 py-3 text-left shadow-none transition-colors duration-150 last:border-b-0 md:px-5",
                      isActive
                        ? "bg-[color-mix(in_oklab,var(--primary)_10%,var(--surface))]"
                        : "bg-transparent hover:bg-[var(--surface-muted)]",
                    )}
```

4. Replace the row title class with:

```tsx
                          <span className="block truncate text-[0.95rem] font-semibold text-[var(--foreground)]">
```

5. Replace the subtitle class with:

```tsx
                            <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
```

6. Replace the latest preview class with:

```tsx
                      <span className="mt-1 block truncate text-sm leading-5 text-[var(--muted-foreground)]">
```

- [ ] **Step 6: Make avatars less card-like**

In `ConversationAvatar`:

1. For direct avatars, replace the className base with:

```tsx
          "flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.65)] text-sm font-bold tracking-tight text-white shadow-sm ring-1 ring-white/70",
```

2. For group avatars, replace the className with:

```tsx
    <span className="flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.65)] bg-[color-mix(in_oklab,var(--accent)_14%,white)] text-[var(--accent)] shadow-sm ring-1 ring-white/70">
```

- [ ] **Step 7: Run conversation list tests**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ConversationList.test.tsx
```

Expected: PASS. Existing behavior assertions for text, unread count, ordering, realtime merges, and navigation must still pass.

- [ ] **Step 8: Commit or safely skip commit**

If safe to commit only this task's hunks, run:

```bash
git add web/src/features/im/components/ConversationList.tsx web/src/features/im/components/ConversationList.test.tsx
git commit -m "feat: restyle conversation roster"
```

If these files had pre-existing modifications, do not commit. Report:

```text
Skipped commit for Task 2 because target files had pre-existing modifications. Changed files: web/src/features/im/components/ConversationList.tsx, web/src/features/im/components/ConversationList.test.tsx.
```

---

### Task 3: Fixed Chat Workspace and Compact Composer

**Files:**
- Modify: `web/src/features/im/components/ChatView.tsx`
- Modify: `web/src/features/im/components/MessageInput.tsx`
- Test: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: `ChatView({ conversationId }: { conversationId: string })` public component API unchanged.
- Consumes: `MessageInput({ disabled, disabledReason, onSend })` public component API unchanged.
- Produces: loaded chat root is still a `section` containing a `header`, `MessageList`, and `MessageInput` in that order.
- Produces: message send keyboard behavior remains Enter to send and Shift+Enter to insert newline.

- [ ] **Step 1: Capture current worktree state**

Run:

```bash
git status --short
```

Expected: Shows any pre-existing dirty files. Do not revert them.

- [ ] **Step 2: Add a failing fixed-zone chat workspace test**

Append this test inside `describe("ChatView", () => { ... })` after the subtitle test:

```tsx
  it("renders the loaded chat as fixed header, scroll area, and composer zones", async () => {
    await renderChatView({
      listMessages: vi.fn<ApiClient["listMessages"]>().mockResolvedValue([
        message(1, "Client layout message"),
      ]),
    });

    const heading = await screen.findByRole("heading", { name: "Bob" });
    const chatSection = heading.closest("section");
    const chatHeader = heading.closest("header");
    const messageList = await screen.findByLabelText("Message list");
    const composer = screen.getByRole("textbox", { name: "Message" }).closest("form");

    expect(chatSection).toHaveClass("h-full", "min-h-0", "overflow-hidden", "rounded-none", "shadow-none");
    expect(chatHeader).toHaveClass("shrink-0");
    expect(messageList).toHaveClass("h-full", "min-h-0", "overflow-y-auto");
    expect(composer).toHaveClass("shrink-0");
  });
```

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ChatView.test.tsx --testNamePattern "fixed header"
```

Expected: FAIL because the current chat section is rounded/card-like and composer form lacks the expected fixed-zone class.

- [ ] **Step 4: Convert `ChatView` loaded root to an edge-to-edge chat workspace**

In `LoadedChatView` in `web/src/features/im/components/ChatView.tsx`, replace the loaded root section className with:

```tsx
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-[var(--surface-muted)] shadow-none">
```

Replace the `header` className with:

```tsx
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 md:h-[4.5rem] md:px-6">
```

Replace the eyebrow class with:

```tsx
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
```

Replace the title class with:

```tsx
          <h2 className="truncate text-lg font-semibold tracking-tight md:text-xl">
```

Replace the subtitle class with:

```tsx
            <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)] md:text-sm">
```

Replace the right action wrapper with:

```tsx
        <div className="flex shrink-0 items-center gap-2">
```

- [ ] **Step 5: Restyle chat notice states to fit the client surface**

In `ChatViewNotice`, replace the section className with:

```tsx
    <section className="flex h-full min-h-0 w-full items-center justify-center bg-[var(--surface-muted)] p-8 text-center">
```

Keep the title and description content unchanged.

- [ ] **Step 6: Make the composer compact and fixed-zone**

In `web/src/features/im/components/MessageInput.tsx`, replace the form className with:

```tsx
      className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4"
```

Replace the disabled reason className with:

```tsx
        <p className="mb-3 rounded-[calc(var(--radius)*0.65)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--muted-foreground)]">
```

Replace the input row className with:

```tsx
      <div className="flex items-end gap-2 md:gap-3">
```

Replace the `Textarea` className with:

```tsx
          className="max-h-40 min-h-10 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
```

Replace the send `Button` className with:

```tsx
          className="h-10 rounded-[calc(var(--radius)*0.65)] px-3 md:px-4"
```

- [ ] **Step 7: Run chat view tests**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ChatView.test.tsx
```

Expected: PASS. Existing validation, Enter-to-send, Shift+Enter, realtime, and mark-read behavior must continue to pass.

- [ ] **Step 8: Commit or safely skip commit**

If safe to commit only this task's hunks, run:

```bash
git add web/src/features/im/components/ChatView.tsx web/src/features/im/components/MessageInput.tsx web/src/features/im/components/ChatView.test.tsx
git commit -m "feat: fix chat workspace zones"
```

If these files had pre-existing modifications, do not commit. Report:

```text
Skipped commit for Task 3 because target files had pre-existing modifications. Changed files: web/src/features/im/components/ChatView.tsx, web/src/features/im/components/MessageInput.tsx, web/src/features/im/components/ChatView.test.tsx.
```

---

### Task 4: IM Message Bubbles with Incoming Avatars

**Files:**
- Modify: `web/src/features/im/components/MessageList.tsx`
- Test: `web/src/features/im/components/MessageList.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage.sender: UserSummary` for incoming avatar rendering.
- Consumes: `getAvatarVisual(user: AvatarUser): AvatarVisual` from `web/src/shared/utils/avatar.ts`.
- Produces: incoming text messages render a sender avatar with `aria-label="<display name> avatar"`.
- Produces: outgoing text messages do not render an avatar.
- Produces: existing `MessageListProps` remains unchanged.

- [ ] **Step 1: Capture current worktree state**

Run:

```bash
git status --short
```

Expected: Shows any pre-existing dirty files. Do not revert them.

- [ ] **Step 2: Add a failing incoming-avatar test**

Append this test inside `describe("MessageList", () => { ... })` after the sequence-number tests:

```tsx
  it("shows avatars for incoming messages and omits them for outgoing messages", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(1), message(2)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Bob avatar")).toHaveTextContent("B");
    expect(screen.queryByLabelText("Alice avatar")).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/MessageList.test.tsx --testNamePattern "shows avatars"
```

Expected: FAIL because incoming message avatars are not rendered yet.

- [ ] **Step 4: Import avatar utilities**

At the top of `web/src/features/im/components/MessageList.tsx`, add:

```tsx
import type { UserSummary } from "@/shared/api/types";
import { getAvatarVisual } from "@/shared/utils/avatar";
```

Keep the existing imports.

- [ ] **Step 5: Update the message list surface and timestamp/call rows**

In `MessageList`, replace the outer background class with:

```tsx
    <div className="relative min-h-0 flex-1 bg-[var(--surface-muted)]">
```

Replace the scroll container className with:

```tsx
        className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-4 md:px-6 md:py-5"
```

Replace the ordered list className with:

```tsx
          <ol className="mt-auto space-y-2.5">
```

In `MessageTimestamp`, replace the time className with:

```tsx
      <time className="rounded-md bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-2 py-0.5 text-[0.68rem] font-medium text-[var(--muted-foreground)]">
```

In `CallEventMessage`, replace the div className with:

```tsx
      <div className="max-w-[78%] rounded-full bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] px-3 py-1.5 text-center text-xs font-semibold text-[var(--muted-foreground)]">
```

- [ ] **Step 6: Render incoming avatars beside message bubbles**

Replace the `return` block of `MessageBubble` with this structure:

```tsx
  return (
    <li
      className={cn(
        "flex items-end gap-2",
        isOutgoing ? "justify-end" : "justify-start",
      )}
    >
      {!isOutgoing ? <MessageSenderAvatar user={message.sender} /> : null}
      <div
        className={cn(
          "max-w-[min(78%,42rem)] rounded-[calc(var(--radius)*0.8)] px-3.5 py-2.5 shadow-sm",
          isOutgoing
            ? "rounded-br-[0.35rem] bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "rounded-bl-[0.35rem] border border-[var(--border)] bg-[var(--bubble-incoming)] text-[var(--foreground)]",
          isFailed ? "ring-2 ring-[var(--destructive)]/40" : null,
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.body}
        </p>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] opacity-70",
            isOutgoing ? "justify-end" : "justify-start",
          )}
        >
          {showMessageSequenceNumber && isServerSequenced(message) ? (
            <span>#{message.message_seq}</span>
          ) : null}
          {isPending ? <span>{t("im.messageList.pending")}</span> : null}
          {isFailed ? <span>{t("im.messageInput.sendFailure")}</span> : null}
        </div>
        {isFailed ? (
          <button
            className={cn(
              "mt-2 text-xs font-bold underline-offset-4 hover:underline",
              isOutgoing ? "text-white" : "text-[var(--destructive)]",
            )}
            onClick={() => onRetry(message)}
            type="button"
          >
            {t("im.messageInput.retry")}
          </button>
        ) : null}
      </div>
    </li>
  );
```

- [ ] **Step 7: Add avatar helper functions below `MessageBubble`**

Add these helpers below `MessageBubble` and above `TimestampedChatMessage`:

```tsx
function MessageSenderAvatar({ user }: { user: UserSummary }) {
  const avatar = getAvatarVisual(user);
  const label = `${displaySenderName(user)} avatar`;

  return (
    <span
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.55)] text-[0.68rem] font-bold text-white shadow-sm ring-1 ring-white/70",
        avatar.gradientClassName,
      )}
    >
      {avatar.initials}
    </span>
  );
}

function displaySenderName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}
```

- [ ] **Step 8: Restyle back-to-bottom and notice states**

Replace the back-to-bottom button className with:

```tsx
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] shadow-md"
```

Replace `MessageListNotice` className with:

```tsx
    <div className="mx-auto mt-auto max-w-sm rounded-[calc(var(--radius)*0.75)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm font-semibold text-[var(--muted-foreground)]">
```

- [ ] **Step 9: Run message list tests**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/MessageList.test.tsx
```

Expected: PASS. Existing timestamp, sequence-number, call-event, scroll preservation, and back-to-bottom assertions must still pass.

- [ ] **Step 10: Commit or safely skip commit**

If safe to commit only this task's hunks, run:

```bash
git add web/src/features/im/components/MessageList.tsx web/src/features/im/components/MessageList.test.tsx
git commit -m "feat: restyle im message bubbles"
```

If these files had pre-existing modifications, do not commit. Report:

```text
Skipped commit for Task 4 because target files had pre-existing modifications. Changed files: web/src/features/im/components/MessageList.tsx, web/src/features/im/components/MessageList.test.tsx.
```

---

### Task 5: End-to-End UI Verification and Polish

**Files:**
- Modify only if a previous task caused an intentional class/test mismatch:
  - `web/src/features/shell/AppShell.test.tsx`
  - `web/src/features/im/components/ConversationList.test.tsx`
  - `web/src/features/im/components/ChatView.test.tsx`
  - `web/src/features/im/components/MessageList.test.tsx`
  - `web/src/styles.css`

**Interfaces:**
- Consumes: all task outputs.
- Produces: full web typecheck and test suite pass, or a precise failure report if an unrelated pre-existing failure blocks completion.

- [ ] **Step 1: Capture final worktree state before verification**

Run:

```bash
git status --short
```

Expected: Shows changed files from completed tasks plus any pre-existing dirty files.

- [ ] **Step 2: Run focused component tests together**

Run:

```bash
cd web && pnpm vitest run src/features/shell/AppShell.test.tsx src/features/im/components/ConversationList.test.tsx src/features/im/components/ChatView.test.tsx src/features/im/components/MessageList.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd web && pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run the full web test suite**

Run:

```bash
cd web && pnpm test
```

Expected: PASS. If a failure is unrelated to this UI work and existed before the task, capture the exact failing test name and error output.

- [ ] **Step 5: Optional style token cleanup only if needed**

If the changed UI reveals body-level gradients competing with the client frame, make this minimal `web/src/styles.css` adjustment and no other palette change:

```css
body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

After changing `styles.css`, rerun:

```bash
cd web && pnpm typecheck && pnpm vitest run src/features/shell/AppShell.test.tsx src/features/im/components/ConversationList.test.tsx src/features/im/components/ChatView.test.tsx src/features/im/components/MessageList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Produce final implementation summary**

Report:

```text
Implemented WeChat-style main chat UI redesign.
Changed areas:
- Shell frame and mobile feature bar visibility
- Desktop feature rail density
- IM conversation roster rows
- Fixed chat header/message/composer zones
- Incoming message avatars and IM bubble styling
Verification:
- pnpm vitest run src/features/shell/AppShell.test.tsx src/features/im/components/ConversationList.test.tsx src/features/im/components/ChatView.test.tsx src/features/im/components/MessageList.test.tsx: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
Commit status: committed per task or skipped safely due pre-existing dirty files
```

- [ ] **Step 7: Commit or safely skip final cleanup**

If `web/src/styles.css` or test-only polish was changed in this task and can be safely committed, run:

```bash
git add web/src/styles.css web/src/features/shell/AppShell.test.tsx web/src/features/im/components/ConversationList.test.tsx web/src/features/im/components/ChatView.test.tsx web/src/features/im/components/MessageList.test.tsx
git commit -m "test: verify wechat-style chat ui"
```

If target files had pre-existing modifications or no files changed in this task, do not commit. Report the reason.
