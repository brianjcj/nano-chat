# Message input multiline resize design

## Context

The chat composer already uses a `<textarea>`, but it currently auto-resizes in code and disables manual resize with `resize-none`. Its keyboard behavior sends on bare Enter and inserts a newline only with Shift+Enter.

## Approved behavior

- Keep bare `Enter` as the send shortcut.
- Allow `Shift+Enter` to insert a newline.
- Add `Ctrl+Enter` as another newline shortcut.
- Let users resize the input vertically with the mouse.

## Approach

Use a minimal change in `MessageInput`:

- Remove the body-driven auto-height effect so manual resizing is not overwritten.
- Change the textarea class from `resize-none` to vertical resize behavior.
- Update the Enter key handler so bare Enter sends, while Shift+Enter or Ctrl+Enter falls through to the browser textarea newline behavior.

This keeps the existing form submission path, validation, disabled state, and send button behavior unchanged.

## Tests

Update existing chat composer tests to cover:

- `Shift+Enter` still inserts a newline and bare `Enter` sends.
- `Ctrl+Enter` inserts a newline and bare `Enter` sends.
- The composer exposes vertical resize styling rather than disabling resize.
