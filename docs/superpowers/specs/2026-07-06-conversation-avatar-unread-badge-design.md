# Conversation Avatar Unread Badge Design

## Goal

Move the conversation-list unread count off the right-side message metadata stack and onto the user/group avatar, so unread conversations read as a compact avatar badge instead of adding a separate visual row.

## Chosen Design

Use a numeric badge on the avatar's top-right corner. The badge remains visible only when `unreadCount > 0` and keeps the existing accessible label such as `5 unread`.

## UI Behavior

- Direct conversations show the numeric unread badge on the direct user's avatar.
- Group conversations show the numeric unread badge on the group icon.
- The right side of the title row shows only the latest message time when available.
- Conversations with no unread messages render no badge.
- Badge placement slightly overlaps/floats outside the avatar's top-right corner to avoid consuming a separate row and to preserve the existing row density.

## Implementation Notes

- Pass the computed `unreadCount` into `ConversationAvatar`.
- Wrap the avatar visual in a relative container.
- Render the numeric badge as an absolutely positioned element at the top-right of that container.
- Remove unread-count rendering from the right-side time stack.
- Keep the existing unread translation key and `aria-label` behavior for accessibility and test compatibility.

## Testing

- Update/add component coverage proving the unread badge belongs to the avatar container rather than the right-side timestamp stack.
- Run the focused conversation-list tests after implementation.
