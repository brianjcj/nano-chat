# Composer button layout design

## Context

The current message composer places the textarea and send button in the same horizontal row. This makes the input field visually shorter and asymmetric because the send button consumes width on the right side.

## Approved behavior

- Keep the existing horizontal splitter resize behavior unchanged.
- Keep the existing keyboard behavior unchanged:
  - Bare `Enter` sends.
  - `Shift+Enter` inserts a newline.
  - `Ctrl+Enter` inserts a newline.
  - `Alt+Enter` and `Meta+Enter` do not send.
- Move the send button out of the textarea row.
- Make the textarea occupy the full composer width with balanced left/right spacing.
- Place the send button on its own row at the bottom-right of the composer panel.
- Make the send button visually smaller than the current full-height row button.
- Preserve validation, disabled behavior, focus restoration, realtime payload shape, and the current-lifecycle-only panel height state.

## Approach

Keep the change localized in `MessageInput`:

- Change the composer content from a single horizontal row to a vertical stack.
- Let the textarea fill the available width and main vertical space.
- Add a lower action row that right-aligns a smaller send button.
- Use a compact button height and text size while retaining the icon and translated label.
- Keep the splitter and resize state untouched.

## Tests

Update composer tests to verify:

- The textarea and send button are no longer siblings in the same horizontal row.
- The send button is rendered in a bottom action row aligned to the right.
- The send button uses compact sizing.
- Existing keyboard send/newline behavior and splitter tests continue to pass.
