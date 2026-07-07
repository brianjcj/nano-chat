# Realtime Message Fetch Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the current chat from fetching a duplicate latest 50-message page when an in-order realtime `message.created` event already delivered the new message.

**Architecture:** Keep the change inside the web IM message-loading boundary. `cacheUpdates.ts` continues to merge realtime messages into the canonical message cache; `useConversationMessages.ts` tracks the latest-page fetch target separately from every live `conversation.latest_message_seq` change and only advances that target when the backend summary is ahead of locally cached messages.

**Tech Stack:** React 19, TypeScript 6, TanStack Query 5, Vitest, Testing Library, Zustand IM store.

## Global Constraints

- Do not change backend APIs for this iteration; use the existing `after_seq`, `before_seq`, and `limit` query parameters.
- Preserve initial conversation load: opening a conversation still fetches its latest page.
- Superseded gap recovery note: realtime sequence gaps now use backward `before_seq` history backfill markers.
- Preserve older-history pagination: "Load older messages" still requests `before_seq = current minimum message_seq` with `limit = 50`.
- Preserve reconnect/focus recovery: when the conversation summary advances without the latest message in local cache, the hook must fetch a new latest page.

---

### Task 1: Current-conversation realtime latest-page suppression

**Files:**
- Modify: `web/src/features/im/components/ChatView.test.tsx`
- Modify: `web/src/features/im/hooks/useConversationMessages.ts`

**Interfaces:**
- Consumes: `applyRealtimeEvent({ queryClient, store, currentUserId, event })` from `web/src/features/im/state/cacheUpdates.ts`.
- Consumes: `imQueryKeys.messages(conversationId)` canonical loaded-message cache.
- Produces: `useConversationMessages(conversation)` behavior where `latestFetchBeforeSeqByConversationId[conversationId]` is the stable latest-page fetch upper bound for the open conversation.
- Produces: helper `isMessageSeqLoaded(messages: ChatMessage[], messageSeq: number): boolean`, returning true when the canonical cache already contains a server-sequenced message at or beyond `messageSeq`.

- [ ] **Step 1: Write failing tests for realtime suppression and recovery fetch**

Add this import near the other IM imports in `web/src/features/im/components/ChatView.test.tsx`:

```ts
import { applyRealtimeEvent } from "@/features/im/state/cacheUpdates";
```

Add these tests after the existing test named `requests latest messages with before_seq one greater than latest_message_seq`:

```ts
  it("does not refetch the latest page when realtime appends the current conversation message", async () => {
    const initialLatestMessage = message(7);
    const realtimeMessage = message(8);
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValue([message(6), initialLatestMessage]);
    const { queryClient } = await renderChatView({
      conversations: [
        conversation({
          latest_message_seq: initialLatestMessage.message_seq,
          read_seq: initialLatestMessage.message_seq,
          unread_count: 0,
          latest_message: latestMessageSummary(initialLatestMessage),
        }),
      ],
      listMessages,
    });

    expect(await screen.findByText("Message 7")).toBeInTheDocument();
    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 8,
        limit: 50,
      });
    });

    listMessages.mockClear();

    act(() => {
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: localUser.user_id,
        event: {
          type: "message.created",
          payload: {
            conversation_id: "conversation-1",
            message: realtimeMessage,
          },
        },
      });
    });

    expect(await screen.findByText("Message 8")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual([6, 7, 8]);
    });
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("refetches the latest page when the conversation summary advances without the latest cached message", async () => {
    const initialLatestMessage = message(7);
    const recoveredLatestMessage = message(9);
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValueOnce([message(6), initialLatestMessage])
      .mockResolvedValueOnce([message(8), recoveredLatestMessage]);
    const { queryClient } = await renderChatView({
      conversations: [
        conversation({
          latest_message_seq: initialLatestMessage.message_seq,
          read_seq: initialLatestMessage.message_seq,
          unread_count: 0,
          latest_message: latestMessageSummary(initialLatestMessage),
        }),
      ],
      listMessages,
    });

    expect(await screen.findByText("Message 7")).toBeInTheDocument();
    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 8,
        limit: 50,
      });
    });

    listMessages.mockClear();

    act(() => {
      queryClient.setQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
        [
          conversation({
            latest_message_seq: recoveredLatestMessage.message_seq,
            read_seq: initialLatestMessage.message_seq,
            unread_count: 2,
            latest_message: latestMessageSummary(recoveredLatestMessage),
          }),
        ],
      );
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 10,
        limit: 50,
      });
    });
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual([6, 7, 8, 9]);
    });
  });
```

- [ ] **Step 2: Run the tests and verify the realtime suppression test fails**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: FAIL. The first new test should show `listMessages` was called after the realtime event, with a latest-page query like:

```ts
{
  before_seq: 9,
  limit: 50,
}
```

- [ ] **Step 3: Implement stable latest-page fetch targets in `useConversationMessages`**

In `web/src/features/im/hooks/useConversationMessages.ts`, add `latestMessageSeq`, a per-conversation fetch target state, and derive `latestQuery` from that target instead of deriving it directly from every `conversation.latest_message_seq` change.

Replace the top of `useConversationMessages` through the `latestQuery` definition with this code:

```ts
export function useConversationMessages(
  conversation: ConversationSummary | null | undefined,
): UseConversationMessagesResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const conversationId = conversation?.conversation_id ?? "";
  const latestMessageSeq = conversation?.latest_message_seq ?? 0;
  const canonicalMessagesKey = imQueryKeys.messages(conversationId);
  const [isFetchingOlder, setIsFetchingOlder] = useState(false);
  const [loadedAllHistoryByConversationId, setLoadedAllHistoryByConversationId] =
    useState<Record<string, boolean>>({});
  const [latestFetchBeforeSeqByConversationId, setLatestFetchBeforeSeqByConversationId] =
    useState<Record<string, number>>(() =>
      conversation
        ? {
            [conversation.conversation_id]: conversation.latest_message_seq + 1,
          }
        : {},
    );
  const inFlightHistorySyncsRef = useRef<Record<string, number>>({});
  const historyBackfillMarker = useImStore((state) =>
    conversationId ? state.historyBackfillMarkers[conversationId] : undefined,
  );
  const latestFetchBeforeSeq = conversationId
    ? (latestFetchBeforeSeqByConversationId[conversationId] ??
      latestMessageSeq + 1)
    : 1;

  const latestQuery = useMemo(
    () => ({
      before_seq: latestFetchBeforeSeq,
      limit: HISTORY_PAGE_SIZE,
    }),
    [latestFetchBeforeSeq],
  );
```

After `latestMessagesQuery` and before the existing effect that merges `latestMessagesQuery.data`, add this effect:

```ts
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const nextBeforeSeq = latestMessageSeq + 1;

    setLatestFetchBeforeSeqByConversationId((targets) => {
      const currentBeforeSeq = targets[conversationId];

      if (currentBeforeSeq === undefined) {
        return {
          ...targets,
          [conversationId]: nextBeforeSeq,
        };
      }

      if (nextBeforeSeq <= currentBeforeSeq) {
        return targets;
      }

      const existingMessages =
        queryClient.getQueryData<ChatMessage[]>(imQueryKeys.messages(conversationId)) ?? [];

      if (isMessageSeqLoaded(existingMessages, latestMessageSeq)) {
        return targets;
      }

      return {
        ...targets,
        [conversationId]: nextBeforeSeq,
      };
    });
  }, [conversationId, latestMessageSeq, queryClient]);
```

Add this helper below `markAllHistoryLoaded`:

```ts
function isMessageSeqLoaded(messages: ChatMessage[], messageSeq: number) {
  if (messageSeq <= 0) {
    return true;
  }

  return messages.some(
    (message) => isServerSequenced(message) && message.message_seq >= messageSeq,
  );
}
```

- [ ] **Step 4: Run the focused chat tests and verify they pass**

Run:

```bash
cd web && pnpm test -- src/features/im/components/ChatView.test.tsx
```

Expected: PASS for all `ChatView` tests.

- [ ] **Step 5: Run typecheck and lint for regression coverage**

Run:

```bash
cd web && pnpm typecheck && pnpm lint
```

Expected: both commands exit 0. If `pnpm lint` reports a wrapping issue in one of these snippets, keep the code behavior identical and adjust wrapping to satisfy the configured ESLint rules.

- [ ] **Step 6: Commit the implementation**

Run:

```bash
git add web/src/features/im/components/ChatView.test.tsx web/src/features/im/hooks/useConversationMessages.ts
git commit -m "fix: avoid duplicate realtime message history fetches"
```

Expected: commit succeeds and `git status --short` shows no changes to those two implementation files.

## Self-Review

- Spec coverage: the task preserves initial latest-page loading, suppresses duplicate latest-page fetches after in-order realtime messages, preserves `after_seq` gap sync, preserves older-history pagination, and preserves recovery fetches when a conversation summary is ahead of local cache.
- Placeholder scan: this plan contains exact file paths, test code, implementation code, commands, and expected outcomes.
- Type consistency: the plan uses existing project types `ChatMessage`, `ConversationSummary`, `ApiClient["listMessages"]`, `Message`, and existing functions `applyRealtimeEvent`, `imQueryKeys.messages`, and `isServerSequenced`.
