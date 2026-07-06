# Account Menu Sidebar Placement Design

## Goal
Move the authenticated user account menu out of the floating top-right position and make it feel like a first-class navigation control.

## Approved Layout
- Desktop: the account menu is the first control in the left feature rail, at the top-left of the app shell.
- Mobile: the account menu remains available, but moves into the bottom mobile feature bar as a compact avatar/account control.
- The old fixed top-right account menu is removed on all breakpoints.

## Components
- `AppShell` owns the shell layout and should no longer render a fixed top-right `UserMenu`.
- `DesktopRail` renders `UserMenu` before the IM navigation entry.
- `MobileFeatureBar` renders `UserMenu` alongside the IM navigation entry.
- `UserMenu` supports compact rail/mobile trigger variants while keeping the existing disclosure, language, logout, and edit-profile behavior.

## Accessibility
- The account trigger remains a real button with `aria-expanded` and `aria-controls`.
- The disclosure remains a labelled region, not a menu widget.
- Tests should scope account-menu queries to the desktop rail or mobile feature bar because both breakpoint variants are present in the DOM during unit tests.

## Testing
- Add/adjust AppShell tests to verify the account menu is in the desktop rail and mobile feature bar.
- Keep existing tests for Escape close, language switch, logout, and profile edit behavior passing through the relocated trigger.
