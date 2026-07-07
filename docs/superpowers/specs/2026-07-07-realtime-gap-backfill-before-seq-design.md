# Realtime gap backfill with before_seq design

## Context

The previous realtime message fetch optimization stopped the current chat from refetching the latest 50-message page when an in-order `message.created` event already supplied the new message. That design intentionally preserved the existing sequence-gap recovery path: when a gap was detected, the Web application marked a history sync with `after_seq` and fetched messages after the last contiguous sequence.

We now want gap recovery to use the same backward history direction as normal latest-page and older-history loading. When a realtime event or latest-page refetch reveals that the loaded messages have a hole, the Web application should page backward with `before_seq` instead of paging forward with `after_seq`.

This supersedes the gap-recovery bullet in `docs/superpowers/specs/2026-07-07-realtime-message-fetch-optimization-design.md` that said to preserve the current `after_seq` marker flow.

## Approved behavior

- Do not use `after_seq` for automatic realtime/message-history gap recovery in the Web application.
- When a `message.created` event for the open conversation reveals a missing sequence before the incoming message, append the incoming message from the realtime payload and start a backward backfill using `before_seq`.
- When a latest-page fetch reveals a loaded middle gap, continue filling that gap by requesting older pages with `before_seq`.
- Keep `before_seq` pagination exclusive, matching the API contract: `before_seq = N` requests messages with `message_seq < N`.
- Continue backfilling while full pages still do not reach or overlap the already-loaded lower side of the gap.
- Stop backfilling when the newly fetched page reaches/overlaps existing loaded messages, when it returns fewer than a full page, or when it returns no messages.
- Keep the manual "Load older messages" behavior unchanged: it still requests `before_seq = current minimum loaded message_seq` with `limit = 50`.
- Keep initial and recovery latest-page fetches unchanged: they still request `before_seq = latest_message_seq + 1` with `limit = 50` when the local cache does not already contain the latest message.
- Do not change backend API behavior. The service still supports both `after_seq` and `before_seq`; this change only updates the Web application's automatic gap recovery strategy.

## Approach

Keep the change localized to the Web IM state and message-loading flow:

- Replace the Web store's automatic history backfill marker payload with `before_seq` backfill semantics.
- Prefer renaming marker helpers/types from "history sync" to "history backfill" so the names match the new direction.
- In realtime event handling (`cacheUpdates.ts`), detect gaps against the highest loaded server sequence for the conversation. If the incoming message's sequence is more than one greater than the loaded tail, record a backfill marker with `before_seq = incoming message_seq`.
- In latest-page merge handling (`useConversationMessages.ts`), if the fetched latest page starts after the already-loaded lower side of the gap, record a backfill marker with `before_seq = fetched minimum message_seq`.
- In the backfill effect, request `listMessages(conversationId, { before_seq, limit })`, merge the results into the canonical message cache, and either clear or continue the marker:
  - Clear when the page is short, empty, or reaches/overlaps already-loaded messages.
  - Continue with `before_seq = fetched minimum message_seq` when a full page still leaves a gap below it.
- Keep the existing latest-page duplicate-suppression logic from the previous optimization.
- Update API/client documentation that previously advised forward recovery from the last contiguous sequence so it describes backward `before_seq` backfill for the Web application.

## Testing

Update existing Web tests around `ChatView`, `useConversationMessages`, and realtime cache updates to cover:

- A realtime gap for the current conversation no longer calls `listMessages` with `after_seq`; it calls with `before_seq` and merges the returned page.
- A large realtime gap continues with another `before_seq` page when the first full backfill page still does not bridge to existing loaded messages.
- A latest-page middle gap is backfilled with `before_seq = fetched minimum message_seq`, not `after_seq = highest contiguous loaded seq`.
- Initial latest-page loading, realtime duplicate-fetch suppression, recovery latest-page fetching, and manual "Load older messages" behavior still pass.
