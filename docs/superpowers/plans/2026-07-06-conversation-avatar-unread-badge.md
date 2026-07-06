# Conversation Avatar Unread Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move conversation-list unread numbers onto the user/group avatar as a top-right numeric badge.

**Architecture:** `ConversationList` already computes unread counts per row. The row will pass that value into `ConversationAvatar`, which becomes responsible for rendering the avatar visual plus its unread badge. The right-side metadata area will render only latest-message time.

**Tech Stack:** React 19, TypeScript, Tailwind CSS utility classes, Vitest, Testing Library.

## Global Constraints

- Keep the existing numeric unread count; do not replace it with a dot.
- Render unread badges only when `unreadCount > 0`.
- Preserve the existing translated unread accessible label, for example `5 unread`.
- Do not add new dependencies.
- Keep the conversation row dense; the badge must not occupy a standalone row.

---

## File Structure

- Modify: `web/src/features/im/components/ConversationList.tsx`
  - Pass `unreadCount` into `ConversationAvatar`.
  - Move badge markup from the row's right-side metadata stack into `ConversationAvatar`.
  - Keep latest time in the right-side metadata area.
- Modify: `web/src/features/im/components/ConversationList.test.tsx`
  - Add coverage proving the unread label lives inside the avatar wrapper and the row remains dense.

---

### Task 1: Move Unread Badge Into Conversation Avatar

**Files:**
- Modify: `web/src/features/im/components/ConversationList.tsx`
- Test: `web/src/features/im/components/ConversationList.test.tsx`

**Interfaces:**
- Consumes: `unreadCount: number` computed inside `ConversationList` row mapping.
- Produces: `ConversationAvatar({ conversation, unreadCount }: { conversation: ConversationSummary; unreadCount: number })` renders the avatar and optional unread badge.

- [x] **Step 1: Write the failing test**

Add this test in `web/src/features/im/components/ConversationList.test.tsx` near the existing unread/rendering tests:

```tsx
  it("renders unread totals as avatar badges instead of right-side metadata", async () => {
    await renderConversationList({
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 5,
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
    const unreadBadge = screen.getByLabelText("5 unread");
    const avatar = unreadBadge.closest('[data-testid="conversation-avatar"]');

    expect(row).toContainElement(unreadBadge);
    expect(avatar).toContainElement(unreadBadge);
    expect(avatar).toHaveClass("relative");
    expect(unreadBadge).toHaveClass("absolute", "-right-1", "-top-1");
    expect(unreadBadge.parentElement).not.toHaveClass("flex-col", "items-end");
  });
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ConversationList.test.tsx -t "renders unread totals as avatar badges instead of right-side metadata"
```

Expected: FAIL because `data-testid="conversation-avatar"` does not exist and the unread badge is still in the right-side metadata stack.

- [x] **Step 3: Write minimal implementation**

In `web/src/features/im/components/ConversationList.tsx`, change the call site to pass `unreadCount`:

```tsx
                    <ConversationAvatar
                      conversation={conversation}
                      unreadCount={unreadCount}
                    />
```

Change the right-side metadata block so it only depends on `latestTime` and only renders the time:

```tsx
                        {latestTime ? (
                          <span className="flex shrink-0 items-start">
                            <time
                              className="text-xs font-bold tabular-nums text-[var(--muted-foreground)]"
                              dateTime={conversation.latest_message?.created_at}
                            >
                              {latestTime}
                            </time>
                          </span>
                        ) : null}
```

Change `ConversationAvatar` to accept `unreadCount`, wrap the visual in a relative container, and render the badge:

```tsx
function ConversationAvatar({
  conversation,
  unreadCount,
}: {
  conversation: ConversationSummary;
  unreadCount: number;
}) {
  const { t } = useTranslation();
  const unreadBadge =
    unreadCount > 0 ? (
      <span
        aria-label={t("im.conversationList.unread", {
          count: unreadCount,
        })}
        className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-center text-[0.68rem] font-extrabold leading-none tabular-nums text-white shadow-[0_10px_22px_var(--primary-shadow)] ring-2 ring-[var(--surface)]"
      >
        {unreadCount}
      </span>
    ) : null;

  if (conversation.type === "direct" && conversation.direct_user) {
    const avatar = getAvatarVisual(conversation.direct_user);

    return (
      <span
        className="relative flex size-11 shrink-0"
        data-testid="conversation-avatar"
      >
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-[calc(var(--radius)*0.65)] text-sm font-bold tracking-tight text-white shadow-sm ring-1 ring-white/70",
            avatar.gradientClassName,
          )}
        >
          {avatar.initials}
        </span>
        {unreadBadge}
      </span>
    );
  }

  return (
    <span
      className="relative flex size-11 shrink-0"
      data-testid="conversation-avatar"
    >
      <span className="flex size-11 items-center justify-center rounded-[calc(var(--radius)*0.65)] bg-[color-mix(in_oklab,var(--accent)_14%,white)] text-[var(--accent)] shadow-sm ring-1 ring-white/70">
        <MessageCircleHeart aria-hidden="true" className="size-5" />
      </span>
      {unreadBadge}
    </span>
  );
}
```

- [x] **Step 4: Run focused tests**

Run:

```bash
cd web && pnpm vitest run src/features/im/components/ConversationList.test.tsx
```

Expected: PASS.

- [x] **Step 5: Run typecheck**

Run:

```bash
cd web && pnpm typecheck
```

Expected: PASS.

- [x] **Step 6: Commit**

Run:

```bash
git add web/src/features/im/components/ConversationList.tsx web/src/features/im/components/ConversationList.test.tsx docs/superpowers/plans/2026-07-06-conversation-avatar-unread-badge.md
git commit -m "style: move unread count onto conversation avatars"
```
