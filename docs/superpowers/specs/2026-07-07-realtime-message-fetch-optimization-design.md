# Realtime message fetch optimization design

## Context

The Web IM chat view loads a latest message page in `web/src/features/im/hooks/useConversationMessages.ts` with `before_seq = conversation.latest_message_seq + 1` and `limit = 50`. A realtime `message.created` event already carries the complete new message and `web/src/features/im/state/cacheUpdates.ts` merges that message into the canonical message cache. However, the same realtime event also updates the conversation summary's `latest_message_seq`, which changes the latest-page query key and causes the chat view to fetch another 50-message page that mostly duplicates messages already loaded.

## Approved behavior

- Keep using the realtime `message.created` payload as the source for normal in-order new messages while the WebSocket is connected.
- Do not fetch the latest 50-message page just because a realtime event advanced `latest_message_seq` for the currently open conversation.
- Preserve the existing initial conversation load: opening a conversation still fetches its latest page so earlier visible history is available.
- Preserve the existing gap recovery behavior: if a realtime event reveals a missing sequence gap, continue using the current `after_seq` history sync marker flow to fetch missing messages.
- Preserve reconnect/focus recovery: explicit query invalidation after reconnect, browser focus, or online recovery must still be able to fetch the latest page from the backend.
- Do not change backend APIs for this iteration; the existing `after_seq`, `before_seq`, and `limit` query parameters are enough.

## Approach

Keep the change localized to the web message-loading flow:

- Decouple the latest-page fetch request from every live `conversation.latest_message_seq` change.
- Track a per-open-conversation latest-page bootstrap target in `useConversationMessages`. The target is set when the conversation is first opened or when an explicit recovery refetch is needed, not when realtime events alone append messages.
- Continue merging fetched latest pages into the canonical `imQueryKeys.messages(conversationId)` cache with `mergeMessagesBySeq`.
- Keep realtime event handling in `cacheUpdates.ts` responsible for appending the incoming message and marking `historySyncNeeded` when `message_seq` skips past the highest contiguous loaded sequence.
- Make the fetch guard conservative: if the conversation has not completed its initial latest-page bootstrap, do not let a newly appended realtime message suppress that initial fetch.
- Leave older-history pagination unchanged: the "Load older messages" action still requests `before_seq = current minimum message_seq` with `limit = 50`.

## Testing

Update web tests around `ChatView` / `useConversationMessages` to cover:

- Initial conversation rendering still calls `listMessages(conversationId, { before_seq: latest_message_seq + 1, limit: 50 })`.
- After initial messages are loaded, applying a realtime `message.created` event for the current conversation appends the message to the canonical cache without issuing a second latest-page `limit: 50` request.
- A realtime gap still creates/consumes the existing history sync marker and calls `listMessages` with `after_seq` to fill missing messages.
- Existing load-older history behavior remains unchanged.
