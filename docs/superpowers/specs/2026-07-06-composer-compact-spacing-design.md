# Composer compact spacing design

## Context

The composer now uses a vertical stack: textarea on top and the send button in a separate bottom-right row. The send button is still a little too large, the spacing/padding feels too open, and the default input area should show about three lines.

## Approved behavior

- Keep the existing splitter resize behavior unchanged.
- Keep existing keyboard behavior unchanged:
  - Bare `Enter` sends.
  - `Shift+Enter` inserts a newline.
  - `Ctrl+Enter` inserts a newline.
  - `Alt+Enter` and `Meta+Enter` do not send.
- Make the send button smaller than the current compact button.
- Reduce composer panel padding and the gap between the textarea and action row.
- Reduce textarea internal padding slightly.
- Make the textarea default to 3 rows.
- Increase the default composer panel height enough for the 3-row textarea plus the smaller action row.
- Preserve validation, disabled behavior, focus restoration, realtime payload shape, and current-lifecycle-only panel height state.

## Approach

Keep the change localized in `MessageInput`:

- Increase `DEFAULT_MESSAGE_INPUT_HEIGHT_PX` from the old compact-panel value to a value sized for three textarea rows.
- Keep min/max resize bounds unchanged except where existing disabled minimum clamping applies.
- Change textarea `rows` to `3`.
- Tighten form padding, stack gap, textarea padding, button height, button padding, button text size, and icon size.

## Tests

Update existing ChatView composer tests to verify:

- Default panel height reflects the 3-row default.
- Splitter drag and keyboard resize still work from the new default.
- Disabled composer still clamps downward to the disabled minimum.
- The textarea uses `rows=3` and smaller padding classes.
- The send button uses smaller compact sizing and no longer has the previous `h-8` class.
