# Interface Color Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Nano Chat's Web application with a calmer ink-blue, mist, and teal palette while preserving the existing layout and interactions.

**Architecture:** This is a token-first visual refresh. Global CSS variables in `web/src/styles.css` define the palette; component class changes only remove old warm/brown hardcoded fallbacks and make outgoing message bubbles use the dedicated bubble token instead of the primary action token.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 arbitrary value classes, Vitest, Testing Library.

## Global Constraints

- Use the approved “quiet ink-blue + mist surfaces + teal signal” direction.
- Keep the existing layout and component structure.
- No new features.
- No copy changes.
- No routing, API, realtime, or state changes.
- No structural rewrite of the chat layout.
- After implementation, run the Web application typecheck and build scripts.

---

## File Structure

- Modify `web/src/styles.css`: owns global theme tokens, root font stack, body atmosphere, focus/selection colors.
- Modify `web/src/features/shell/DesktopRail.tsx`: owns desktop feature rail chrome; remove old brown fallback and tune active highlight to the new palette.
- Modify `web/src/features/shell/MobileFeatureBar.tsx`: owns mobile navigation chrome; remove old brown fallback and tune active highlight to the new palette.
- Modify `web/src/features/shell/AppShell.tsx`: owns shell frame, empty workspace, and connection banner; remove old brown fallback and keep workspace surfaces calm.
- Modify `web/src/features/im/components/MessageList.tsx`: owns chat canvas and message bubbles; switch outgoing bubbles to `--bubble-outgoing` and deep text.
- Modify `web/src/features/auth/AuthLayout.tsx`: owns auth page atmosphere; replace decorative warm/candy glows with cool mist / teal / blue glows.
- Modify `web/src/shared/ui/form-fields.test.tsx`: adds a source-level token contract test for the approved palette.
- Modify `web/src/features/im/components/MessageList.test.tsx`: adds a behavior-adjacent class contract test for outgoing message bubble styling.

---

### Task 1: Lock the approved palette and outgoing bubble contract with failing tests

**Files:**
- Modify: `web/src/shared/ui/form-fields.test.tsx`
- Modify: `web/src/features/im/components/MessageList.test.tsx`

**Interfaces:**
- Consumes: `styles` string already loaded from `src/styles.css` in `form-fields.test.tsx`; `MessageList` test helper `message(seq: number)` in `MessageList.test.tsx`.
- Produces: Failing tests that require approved CSS token values and outgoing bubbles to use `--bubble-outgoing` rather than `--primary`.

- [ ] **Step 1: Add CSS token contract test**

Append this test case inside the existing `describe("shared form fields", () => { ... })` block in `web/src/shared/ui/form-fields.test.tsx`, after the existing `opts form fields out of the global thick focus outline` test:

```tsx
  it("defines the quiet ink-blue mist theme tokens", () => {
    expect(styles).toContain("--background: #edf4f7;");
    expect(styles).toContain("--foreground: #12232d;");
    expect(styles).toContain("--surface-muted: #f5f9fb;");
    expect(styles).toContain("--primary: #0f9f8f;");
    expect(styles).toContain("--accent: #315c7c;");
    expect(styles).toContain("--bubble-outgoing: #d8f4ee;");
    expect(styles).toContain("--border: #d3e1e8;");
    expect(styles).not.toContain("--background: #fff8f1;");
    expect(styles).not.toContain("--primary: #ff715f;");
    expect(styles).not.toContain("--accent: #8a6dff;");
  });
```

- [ ] **Step 2: Add outgoing message bubble visual contract test**

Append this test case inside the existing `describe("MessageList", () => { ... })` block in `web/src/features/im/components/MessageList.test.tsx`, after the `shows avatars for incoming messages and omits them for outgoing messages` test:

```tsx
  it("uses the calm outgoing bubble token instead of the action color", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(2)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const outgoingBubble = screen.getByText("Message 2").closest("div");

    expect(outgoingBubble).toHaveClass("bg-[var(--bubble-outgoing)]");
    expect(outgoingBubble).toHaveClass("text-[var(--foreground)]");
    expect(outgoingBubble).not.toHaveClass("bg-[var(--primary)]");
    expect(outgoingBubble).not.toHaveClass("text-[var(--primary-foreground)]");
  });
```

- [ ] **Step 3: Run the two focused tests and verify they fail for the intended reasons**

Run from `web/`:

```bash
pnpm test -- src/shared/ui/form-fields.test.tsx src/features/im/components/MessageList.test.tsx
```

Expected: FAIL. The CSS token test should report missing new values such as `--background: #edf4f7;`; the outgoing bubble test should report the current bubble still has `bg-[var(--primary)]` / `text-[var(--primary-foreground)]`.

- [ ] **Step 4: Commit the failing tests**

```bash
git add web/src/shared/ui/form-fields.test.tsx web/src/features/im/components/MessageList.test.tsx
git commit -m "test: lock interface color refresh contracts"
```

---

### Task 2: Apply the ink-blue, mist, and teal visual refresh

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/features/shell/DesktopRail.tsx`
- Modify: `web/src/features/shell/MobileFeatureBar.tsx`
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/im/components/MessageList.tsx`
- Modify: `web/src/features/auth/AuthLayout.tsx`

**Interfaces:**
- Consumes: CSS custom properties defined in `web/src/styles.css`.
- Produces: Updated theme tokens and component class names used by the visual contract tests from Task 1.

- [ ] **Step 1: Replace global theme tokens and body atmosphere**

In `web/src/styles.css`, replace the entire existing `:root { ... }` block with:

```css
:root {
  color-scheme: light;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;

  --background: #edf4f7;
  --foreground: #12232d;
  --surface: #ffffff;
  --surface-muted: #f5f9fb;
  --muted: #dbe8ee;
  --muted-foreground: #5d7180;
  --primary: #0f9f8f;
  --primary-foreground: #ffffff;
  --primary-shadow: rgb(15 159 143 / 22%);
  --accent: #315c7c;
  --accent-foreground: #ffffff;
  --bubble-outgoing: #d8f4ee;
  --bubble-incoming: #ffffff;
  --border: #d3e1e8;
  --ring: #54c3b4;
  --destructive: #c8465a;
  --destructive-foreground: #ffffff;
  --shadow-color: rgb(18 35 45 / 10%);
  --radius: 1rem;
}
```

Then replace the `body { ... }` background declaration with:

```css
  background:
    radial-gradient(circle at 18% 12%, rgb(84 195 180 / 20%), transparent 28rem),
    radial-gradient(circle at 88% 4%, rgb(49 92 124 / 14%), transparent 30rem),
    linear-gradient(135deg, #edf4f7 0%, #f8fbfc 48%, #e8f1f5 100%);
```

Keep the rest of the `body` rule unchanged.

- [ ] **Step 2: Retune auth layout atmosphere**

In `web/src/features/auth/AuthLayout.tsx`, change the `<main>` className from:

```tsx
className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_32%),radial-gradient(circle_at_85%_10%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_34%),var(--background)] text-[var(--foreground)]"
```

to:

```tsx
className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_18%,color-mix(in_oklab,var(--ring)_20%,transparent),transparent_30rem),radial-gradient(circle_at_86%_12%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_32rem),linear-gradient(135deg,var(--background),#f8fbfc_52%,#e8f1f5)] text-[var(--foreground)]"
```

In the same file, change the decorative blurred circle className from:

```tsx
className="absolute -left-12 -top-16 size-48 rounded-full border border-white/70 bg-white/35 blur-2xl"
```

to:

```tsx
className="absolute -left-12 -top-16 size-48 rounded-full border border-white/70 bg-[color-mix(in_oklab,var(--primary)_14%,white)]/70 blur-2xl"
```

- [ ] **Step 3: Remove old brown fallback colors from shell chrome**

In `web/src/features/shell/DesktopRail.tsx`, change the rail `<aside>` className from:

```tsx
className="hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-[color-mix(in_oklab,var(--foreground)_24%,transparent)] bg-[color-mix(in_oklab,var(--foreground)_94%,#3d2c32)] px-2.5 py-4 text-white md:flex"
```

to:

```tsx
className="hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-[color-mix(in_oklab,var(--primary)_26%,var(--foreground))] bg-[linear-gradient(180deg,#12232d_0%,#173446_100%)] px-2.5 py-4 text-white md:flex"
```

In the same file, change the active `NavLink` class string from:

```tsx
"bg-white text-[var(--foreground)] shadow-sm hover:bg-white hover:text-[var(--foreground)]"
```

to:

```tsx
"bg-[var(--primary)] text-white shadow-[0_14px_30px_var(--primary-shadow)] hover:bg-[var(--primary)] hover:text-white"
```

In `web/src/features/shell/MobileFeatureBar.tsx`, change the `<nav>` className from:

```tsx
className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-center gap-2 rounded-[calc(var(--radius)*1.05)] border border-white/72 bg-[color-mix(in_oklab,var(--foreground)_91%,#3d2c32)] p-2 text-white shadow-[0_24px_70px_rgb(33_25_27_/26%)] backdrop-blur md:hidden"
```

to:

```tsx
className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-center gap-2 rounded-[calc(var(--radius)*1.05)] border border-white/70 bg-[linear-gradient(135deg,#12232d_0%,#173446_100%)] p-2 text-white shadow-[0_24px_70px_rgb(18_35_45_/24%)] backdrop-blur md:hidden"
```

In the same file, change the active `NavLink` class string from:

```tsx
isActive && "bg-white text-[var(--foreground)] shadow-lg",
```

to:

```tsx
isActive && "bg-[var(--primary)] text-white shadow-[0_14px_30px_var(--primary-shadow)]",
```

- [ ] **Step 4: Retune shell status banner and empty workspace icon**

In `web/src/features/shell/AppShell.tsx`, change the empty workspace icon wrapper className from:

```tsx
className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[calc(var(--radius)*0.9)] bg-[var(--surface)] text-[var(--muted-foreground)] shadow-sm ring-1 ring-[var(--border)]"
```

to:

```tsx
className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[calc(var(--radius)*0.9)] bg-[color-mix(in_oklab,var(--primary)_10%,white)] text-[var(--primary)] shadow-sm ring-1 ring-[color-mix(in_oklab,var(--primary)_18%,var(--border))]"
```

In the same file, change the connection banner className from:

```tsx
className="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-full border border-white/72 bg-[color-mix(in_oklab,var(--foreground)_92%,#3d2c32)] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_58px_rgb(33_25_27_/24%)] md:top-5"
```

to:

```tsx
className="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-full border border-white/70 bg-[linear-gradient(135deg,#12232d_0%,#173446_100%)] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_58px_rgb(18_35_45_/24%)] md:top-5"
```

- [ ] **Step 5: Switch outgoing message bubbles to the calm bubble token**

In `web/src/features/im/components/MessageList.tsx`, change the message list outer wrapper className from:

```tsx
className="relative min-h-0 flex-1 bg-[var(--surface-muted)]"
```

to:

```tsx
className="relative min-h-0 flex-1 bg-[radial-gradient(circle_at_28%_0%,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_24rem),var(--surface-muted)]"
```

In the same file, in `MessageBubble`, change the outgoing branch of the bubble class from:

```tsx
? "rounded-br-[0.35rem] bg-[var(--primary)] text-[var(--primary-foreground)]"
```

to:

```tsx
? "rounded-br-[0.35rem] border border-[color-mix(in_oklab,var(--primary)_18%,var(--border))] bg-[var(--bubble-outgoing)] text-[var(--foreground)]"
```

Then change the failed retry link color class from the conditional expression:

```tsx
isOutgoing ? "text-white" : "text-[var(--destructive)]",
```

to the single shared class:

```tsx
"text-[var(--destructive)]",
```

- [ ] **Step 6: Run focused tests and verify they pass**

Run from `web/`:

```bash
pnpm test -- src/shared/ui/form-fields.test.tsx src/features/im/components/MessageList.test.tsx
```

Expected: PASS. The token contract should find the new palette values, and the outgoing bubble test should find `bg-[var(--bubble-outgoing)]` / `text-[var(--foreground)]`.

- [ ] **Step 7: Commit the visual refresh**

```bash
git add web/src/styles.css web/src/features/auth/AuthLayout.tsx web/src/features/shell/DesktopRail.tsx web/src/features/shell/MobileFeatureBar.tsx web/src/features/shell/AppShell.tsx web/src/features/im/components/MessageList.tsx
git commit -m "style: refresh interface color palette"
```

---

### Task 3: Full web verification

**Files:**
- No source files changed unless verification exposes a real issue.

**Interfaces:**
- Consumes: Completed Task 1 and Task 2 changes.
- Produces: Fresh verification evidence for typecheck, tests, and production build.

- [ ] **Step 1: Run typecheck**

Run from `web/`:

```bash
pnpm typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the full web test suite**

Run from `web/`:

```bash
pnpm test
```

Expected: exit code 0 with all tests passing.

- [ ] **Step 3: Run production build**

Run from `web/`:

```bash
pnpm build
```

Expected: exit code 0 and Vite writes `dist/` assets.

- [ ] **Step 4: Commit verification-only fixes if any were required**

If any verification command fails and the fix is not covered by Task 2, make the smallest source/test correction, rerun the failed command, then commit:

```bash
git add <changed-files>
git commit -m "fix: address color refresh verification issues"
```

If all commands pass without additional changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: Task 2 covers global tokens, shell, navigation, conversation/chat surfaces, outgoing bubbles, auth atmosphere, and removes old warm/brown fallbacks. Non-goals are preserved because no task changes copy, routing, API, realtime, or state.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain; each task has exact files, exact snippets, exact commands, and expected outcomes.
- Type consistency: tests reference existing `styles`, `MessageList`, `message(seq)`, `vi`, `render`, and `screen` identifiers already present in the target files.
