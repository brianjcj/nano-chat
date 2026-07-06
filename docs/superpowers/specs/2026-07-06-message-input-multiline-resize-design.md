# Message input multiline resize design

## Context

The chat composer uses a `<textarea>` inside `MessageInput`, and the chat layout stacks `MessageList` above `MessageInput` in a flex column. The earlier interpretation enabled native textarea resizing, but the intended interaction is to drag the horizontal boundary between the message list and the input panel so the entire input panel changes height.

## Approved behavior

- Keep bare `Enter` as the send shortcut.
- Allow `Shift+Enter` to insert a newline.
- Add `Ctrl+Enter` as another newline shortcut.
- Add a horizontal splitter at the top edge of the input panel, between the message list and the input panel.
- Dragging the splitter upward increases the input panel height and reduces the message list height.
- Dragging the splitter downward decreases the input panel height and increases the message list height.
- The chosen height is kept only in the current React page lifecycle; refresh or remount returns to the default height.
- Do not persist the height to localStorage or the backend.
- Disable native textarea resize so there is only one resizing affordance.

## Approach

Keep the behavior localized in `MessageInput`:

- Render a small horizontal drag handle at the top of the input panel.
- Store the panel height in component state, initialized to a default height.
- On pointer drag, compute `nextHeight = startHeight + (startPointerY - currentPointerY)` so upward movement increases panel height.
- Clamp height between a reasonable minimum and maximum so the composer remains usable and the message list cannot be fully consumed.
- Apply the height to the form/input panel container.
- Keep the textarea itself flexible inside the panel and use `resize-none`.
- Preserve existing validation, send button behavior, disabled-state behavior, focus restoration, and send payload shape.

## Tests

Update chat composer tests to cover:

- `Shift+Enter` still inserts a newline and bare `Enter` sends.
- `Ctrl+Enter` inserts a newline and bare `Enter` sends.
- The composer exposes a horizontal separator/slider-style drag handle between the message list and input panel.
- Dragging the handle upward increases the input panel height.
- The textarea no longer exposes native `resize-y` behavior.
