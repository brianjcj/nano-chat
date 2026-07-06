# Account Menu Sidebar Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the authenticated account menu from the floating top-right corner into the desktop rail and mobile feature bar.

**Architecture:** Keep account behavior centralized in `UserMenu`, adding compact placement variants for different shell surfaces. `AppShell` stops owning account-menu positioning; `DesktopRail` and `MobileFeatureBar` render the control where users expect it.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind utility classes, react-i18next.

## Global Constraints

- Do not change authentication/session behavior.
- Do not add dependencies.
- Preserve the disclosure semantics already tested for `UserMenu`.
- Keep desktop and mobile account entries visually compact because both live in navigation chrome.

---

### Task 1: Test account menu placement

**Files:**
- Modify: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: existing `renderAppRoute`, `makeAuthResponse`, and AppShell route setup.
- Produces: tests that require a user-menu button inside `Feature rail` and `Mobile feature bar`.

- [ ] **Step 1: Write failing tests and scoped trigger helper**

Add `within` to the Testing Library import and introduce helpers that scope account-menu queries to the intended shell region:

```ts
import { screen, waitFor, within } from "@testing-library/react";

function getDesktopUserMenuTrigger() {
  return within(screen.getByLabelText("Feature rail")).getByRole("button", {
    name: /User menu/i,
  });
}

function getMobileUserMenuTrigger() {
  return within(screen.getByLabelText("Mobile feature bar")).getByRole("button", {
    name: /User menu/i,
  });
}
```

Assert desktop placement in `renders the desktop feature rail, conversation list region, and main workspace`:

```ts
const featureRail = await screen.findByLabelText("Feature rail");
expect(within(featureRail).getByRole("button", { name: /User menu/i })).toBeInTheDocument();
```

Assert mobile placement in `renders the mobile bottom feature bar and keeps the desktop rail hidden until the desktop breakpoint`:

```ts
expect(within(mobileFeatureBar).getByRole("button", { name: /User menu/i })).toBeInTheDocument();
```

Update existing user-menu interaction tests to click `getDesktopUserMenuTrigger()` instead of unscoped `screen.findByRole("button", { name: /User menu/i })`.

- [ ] **Step 2: Run the targeted test to verify RED**

Run:

```bash
cd web && pnpm test src/features/shell/AppShell.test.tsx
```

Expected: FAIL because `Feature rail` and `Mobile feature bar` do not contain a `User menu` button yet.

- [ ] **Step 3: Commit test after implementation, not during RED**

No commit at RED because the repository may already contain unrelated working tree changes.

### Task 2: Move and restyle account menu

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/shell/DesktopRail.tsx`
- Modify: `web/src/features/shell/MobileFeatureBar.tsx`
- Modify: `web/src/features/shell/UserMenu.tsx`
- Modify: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `UserMenu` current session/disclosure behavior.
- Produces: `UserMenu({ placement?: "floating" | "rail" | "mobileBar" })`.

- [ ] **Step 1: Remove floating render from AppShell**

Delete the fixed top-right wrapper:

```tsx
<div className="fixed right-4 top-4 z-40 md:right-6 md:top-5">
  <UserMenu />
</div>
```

Remove the `UserMenu` import from `AppShell.tsx`.

- [ ] **Step 2: Render compact UserMenu in DesktopRail**

Import `UserMenu` and render it as the first rail control:

```tsx
<UserMenu placement="rail" />
```

- [ ] **Step 3: Render compact UserMenu in MobileFeatureBar**

Import `UserMenu` and render it beside the IM `NavLink`:

```tsx
<UserMenu placement="mobileBar" />
```

- [ ] **Step 4: Add placement variants in UserMenu**

Add a prop:

```ts
type UserMenuPlacement = "floating" | "rail" | "mobileBar";

export function UserMenu({ placement = "floating" }: { placement?: UserMenuPlacement }) {
```

Use placement-specific wrapper, trigger, avatar, label, and panel classes so rail opens to the right and mobile opens upward.

- [ ] **Step 5: Run targeted test to verify GREEN**

Run:

```bash
cd web && pnpm test src/features/shell/AppShell.test.tsx
```

Expected: PASS.

### Task 3: Verification

**Files:**
- Verify: `web/src/features/shell/*.tsx`
- Verify: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: completed Task 1 and Task 2.
- Produces: confidence that the shell still typechecks and account behavior works.

- [ ] **Step 1: Run typecheck**

```bash
cd web && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run shell test suite**

```bash
cd web && pnpm test src/features/shell/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Review changed files**

```bash
git diff -- web/src/features/shell/AppShell.tsx web/src/features/shell/DesktopRail.tsx web/src/features/shell/MobileFeatureBar.tsx web/src/features/shell/UserMenu.tsx web/src/features/shell/AppShell.test.tsx
```

Expected: diff only moves/restyles the account menu and updates scoped tests.
