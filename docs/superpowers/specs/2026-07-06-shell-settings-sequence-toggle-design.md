# Shell Settings Sequence Toggle Design

## Goal
Move the message sequence number toggle out of the chat header and into a dedicated settings popup in the app navigation chrome.

## Approved Layout
- Desktop: add a gear settings button at the bottom of the left feature rail.
- Mobile: add the same settings entry to the bottom mobile feature bar so the setting remains reachable on small screens.
- Remove the current `# 序号` / `# Seq` button from the chat header.

## Behavior
- Clicking the settings button opens a disclosure-style popup.
- The popup contains a message display setting for showing message sequence numbers.
- Clicking outside the popup or pressing Escape closes it.
- Toggling the setting updates visible message sequence numbers immediately and persists to `localStorage` under `nano-chat:show-message-sequence-numbers`.

## Architecture
- Store the setting in `useImStore` so shell controls and `ChatView` share one source of truth.
- Keep persistence helpers near the store because the setting is now application-level UI state.
- Add a focused `ShellSettingsMenu` component for the gear trigger and popup.

## Testing
- Add store tests for initial state, localStorage restore, and persistence on toggle.
- Update ChatView tests to use the shell settings popup instead of the removed header button.
- Add shell tests that verify the settings button appears in the desktop rail and mobile feature bar.
