# Conversation sidebar resize design

## Context

The authenticated web shell renders the conversation list sidebar in `web/src/features/shell/AppShell.tsx`. On desktop, the sidebar currently uses a fixed Tailwind width of `md:w-[23rem]`, while mobile switches between full-width conversation and chat panels. The requested change is to let users drag the conversation list sidebar edge to change its desktop width and keep that width after refresh.

## Approved behavior

- Add mouse/pointer drag resizing for the conversation list sidebar.
- The resize affordance appears on the right edge of the conversation list sidebar, between the sidebar and main chat workspace.
- Resizing applies only to desktop layouts (`md` and wider). Mobile behavior stays unchanged: the conversation list remains the active full-width panel when selected.
- Keep the current desktop width as the default: `23rem` / `368px`.
- Clamp the width to a usable range so the sidebar cannot consume the whole workspace or become too narrow. Use `18rem` / `288px` minimum and `34rem` / `544px` maximum.
- Persist the chosen width in `localStorage` under `nano-chat:conversation-sidebar-width`.
- Restore the persisted width on page load/remount when the stored value is valid.
- Ignore invalid, missing, or out-of-range stored values and fall back to the default width.
- Persistence is best-effort: blocked storage reads/writes must not break rendering or resizing.

## Approach

Keep the implementation localized to the shell layout:

- Add constants and small helper functions in `AppShell.tsx` for the storage key, default/min/max widths, clamping, reading, and writing.
- Replace the fixed desktop `md:w-[23rem]` class on the conversation-list `<aside>` with an inline desktop width style driven by React state.
- Preserve existing mobile classes (`flex-1`, mobile panel switching, bottom feature bar spacing), so narrow screens remain unaffected.
- Render a desktop-only vertical separator/handle positioned at the sidebar's right edge.
- On pointer down, record the starting pointer `clientX` and sidebar width, capture the pointer, and prevent accidental text selection.
- On pointer move, compute `nextWidth = startWidth + (currentClientX - startClientX)`, clamp it, update state, and persist it.
- On pointer up/cancel, release pointer capture and clear drag state.
- Add keyboard accessibility for the focused separator:
  - `ArrowLeft` narrows by 8px.
  - `ArrowRight` widens by 8px.
  - `Home` sets minimum width.
  - `End` sets maximum width.
- Expose the handle with `role="separator"`, vertical orientation, and `aria-valuemin` / `aria-valuemax` / `aria-valuenow`.

## Testing

Update `web/src/features/shell/AppShell.test.tsx` to cover:

- The desktop conversation sidebar starts at the default `368px` width and exposes a vertical resize separator.
- Dragging the separator right increases the sidebar width and writes the new value to `localStorage`.
- A remount restores a valid persisted width from `localStorage`.
- Invalid or out-of-range persisted values fall back to the default width.
- Keyboard controls resize the focused separator and update ARIA value attributes.
- Existing shell layout tests still confirm mobile/desktop panel visibility and bounded shell scrolling behavior.
