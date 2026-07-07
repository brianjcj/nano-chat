# Realtime Gap Backfill Before Seq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change automatic Web gap recovery from `after_seq` synchronization to backward `before_seq` backfill while keeping realtime duplicate-fetch suppression.

**Architecture:** Keep backend APIs unchanged and update only the Web application's automatic gap-recovery path. The IM store records a `before_seq` backfill marker, realtime cache updates create that marker when a loaded message window has a gap, and `useConversationMessages` consumes the marker by paging backward until the fetched page reaches the lower loaded side of the gap or reaches the start of history.

**Tech Stack:** React 19, TypeScript 6, TanStack Query 5, Zustand, Vitest, Testing Library, Nano Chat HTTP message history API.

## Global Constraints

- Do not use `after_seq` for automatic realtime/message-history gap recovery in the Web application.
- When a `message.created` event for the open conversation reveals a missing sequence before the incoming message, append the incoming message from the realtime payload and start a backward backfill using `before_seq`.
- When a latest-page fetch reveals a loaded middle gap, continue filling that gap by requesting older pages with `before_seq`.
- Keep `before_seq` pagination exclusive, matching the API contract: `before_seq = N` requests messages with `message_seq < N`.
- Continue backfilling while full pages still do not reach or overlap the already-loaded lower side of the gap.
- Stop backfilling when the newly fetched page reaches/overlaps existing loaded messages, when it returns fewer than a full page, or when it returns no messages.
- Keep the manual "Load older messages" behavior unchanged: it still requests `before_seq = current minimum loaded message_seq` with `limit = 50`.
- Keep initial and recovery latest-page fetches unchanged: they still request `before_seq = latest_message_seq + 1` with `limit = 50` when the local cache does not already contain the latest message.
- Do not change backend API behavior. The service still supports both `after_seq` and `before_seq`; this change only updates the Web application's automatic gap recovery strategy.

---

### Task 1: Web before_seq backfill behavior

**Files:**
- Modify: `web/src/features/im/state/imStore.ts`
- Modify: `web/src/features/im/state/cacheUpdates.ts`
- Modify: `web/src/features/im/state/cacheUpdates.test.ts`
- Modify: `web/src/features/im/hooks/useConversationMessages.ts`
- Modify: `web/src/features/im/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.listMessages(conversationId, query)` with `MessageHistoryQuery.before_seq` and `MessageHistoryQuery.limit`.
- Consumes: canonical message cache at `imQueryKeys.messages(conversationId)`.
- Produces: `HistoryBackfillMarker = { before_seq: number }` in `web/src/features/im/state/imStore.ts`.
- Produces: `historyBackfillMarkers: Record<string, HistoryBackfillMarker>` in `ImStoreState`.
- Produces: `markHistoryBackfillNeeded(conversationId: string, beforeSeq: number): void`.
- Produces: `clearHistoryBackfillMarker(conversationId: string): void`.
- Produces: automatic backfill requests shaped exactly as `{ before_seq: marker.before_seq, limit: 50 }`.

- [ ] **Step 1: Write failing realtime marker tests in `cacheUpdates.test.ts`**

In `web/src/features/im/state/cacheUpdates.test.ts`, replace the two tests named `marks history sync needed when message.created reveals a sequence gap in the current conversation` and `marks history sync needed after the highest contiguous sequence when cached messages have an existing gap` with these three tests:

```ts
  it("marks history backfill needed with before_seq when message.created reveals a sequence gap in the current conversation", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(1),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(3)),
    });

    expect(useImStore.getState().historyBackfillMarkers).toMatchObject({
      "conversation-1": { before_seq: 3 },
    });
  });

  it("does not mark history backfill when realtime extends a loaded recent window", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(51),
      makeMessage(52),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(53)),
    });

    expect(useImStore.getState().historyBackfillMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("marks history backfill from the incoming seq when the loaded window already has a gap", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(1),
      makeMessage(3),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(4)),
    });

    expect(useImStore.getState().historyBackfillMarkers).toMatchObject({
      "conversation-1": { before_seq: 4 },
    });
  });
```

- [ ] **Step 2: Update failing chat backfill tests in `ChatView.test.tsx`**

In `web/src/features/im/components/ChatView.test.tsx`, replace the three legacy forward-sync recovery tests with these before-seq backfill tests:

```ts
  it("consumes a history backfill marker by fetching before_seq and merging missing messages", async () => {
    useImStore.getState().markHistoryBackfillNeeded("conversation-1", 3);
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockImplementation((_conversationId, query) => {
        if (query?.before_seq === 3) {
          return Promise.resolve([message(2)]);
        }

        return Promise.resolve([message(1), message(3)]);
      });
    const queryClient = createQueryClient();

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 3, read_seq: 3, unread_count: 0 }),
      ],
      listMessages,
      queryClient,
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 3,
        limit: 50,
      });
    });
    expect(
      listMessages.mock.calls.some(([, query]) => query?.after_seq !== undefined),
    ).toBe(false);
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual([1, 2, 3]);
    });
    expect(useImStore.getState().historyBackfillMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("detects a reconnect latest-page gap and backfills the inaccessible middle messages with before_seq", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      imQueryKeys.messages("conversation-1"),
      Array.from({ length: 100 }, (_, index) => message(index + 1)),
    );
    const latestPage = Array.from({ length: 50 }, (_, index) =>
      message(index + 151),
    );
    const missingMiddlePage = Array.from({ length: 50 }, (_, index) =>
      message(index + 101),
    );
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockImplementation((_conversationId, query) => {
        if (query?.before_seq === 151) {
          return Promise.resolve(missingMiddlePage);
        }

        return Promise.resolve(latestPage);
      });

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 200, read_seq: 100, unread_count: 100 }),
      ],
      listMessages,
      queryClient,
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 201,
        limit: 50,
      });
    });
    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 151,
        limit: 50,
      });
    });
    expect(
      listMessages.mock.calls.some(([, query]) => query?.after_seq !== undefined),
    ).toBe(false);
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    });
    expect(useImStore.getState().historyBackfillMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("continues history backfill when a full before_seq page leaves a larger gap", async () => {
    useImStore.getState().markHistoryBackfillNeeded("conversation-1", 102);
    const firstBackfillPage = Array.from({ length: 50 }, (_, index) =>
      message(index + 52),
    );
    const secondBackfillPage = Array.from({ length: 50 }, (_, index) =>
      message(index + 2),
    );
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockImplementation((_conversationId, query) => {
        if (query?.before_seq === 102) {
          return Promise.resolve(firstBackfillPage);
        }

        if (query?.before_seq === 52) {
          return Promise.resolve(secondBackfillPage);
        }

        return Promise.resolve([message(102)]);
      });
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      message(1),
      message(102),
    ]);

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 102, read_seq: 102, unread_count: 0 }),
      ],
      listMessages,
      queryClient,
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 102,
        limit: 50,
      });
    });
    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 52,
        limit: 50,
      });
    });
    expect(
      listMessages.mock.calls.some(([, query]) => query?.after_seq !== undefined),
    ).toBe(false);
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual(Array.from({ length: 102 }, (_, index) => index + 1));
    });
    expect(useImStore.getState().historyBackfillMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });
```

- [ ] **Step 3: Run the focused tests and verify they fail before implementation**

Run:

```bash
cd web && pnpm test -- src/features/im/state/cacheUpdates.test.ts src/features/im/components/ChatView.test.tsx
```

Expected: FAIL because `historyBackfillMarkers` and `markHistoryBackfillNeeded` do not exist yet, and the hook still issues automatic `after_seq` gap recovery requests.

- [ ] **Step 4: Rename store marker state and actions in `imStore.ts`**

In `web/src/features/im/state/imStore.ts`, change the history marker type and state/action names to before-seq backfill names:

```ts
export type HistoryBackfillMarker = {
  before_seq: number;
};
```

Use these fields in `ImStoreData`:

```ts
  historyBackfillMarkers: Record<string, HistoryBackfillMarker>;
```

Use these actions in `ImStoreActions`:

```ts
  markHistoryBackfillNeeded: (conversationId: string, beforeSeq: number) => void;
  clearHistoryBackfillMarker: (conversationId: string) => void;
```

Replace the old marker action implementations with:

```ts
  markHistoryBackfillNeeded(conversationId, beforeSeq) {
    set((state) => ({
      historyBackfillMarkers: {
        ...state.historyBackfillMarkers,
        [conversationId]: { before_seq: beforeSeq },
      },
    }));
  },
  clearHistoryBackfillMarker(conversationId) {
    set((state) => {
      const historyBackfillMarkers = { ...state.historyBackfillMarkers };
      delete historyBackfillMarkers[conversationId];

      return { historyBackfillMarkers };
    });
  },
```

Set the initial data field to:

```ts
    historyBackfillMarkers: {},
```

- [ ] **Step 5: Update realtime gap marker creation in `cacheUpdates.ts`**

In `web/src/features/im/state/cacheUpdates.ts`, change `applyMessageCreated` so it records a before-seq backfill marker when the incoming message is not contiguous with the loaded message window. The relevant block should use this shape:

```ts
  const highestContiguousLoadedSeq = getHighestContiguousLoadedMessageSeq(
    queryClient,
    conversationId,
  );
```

Inside the `if (currentConversationId === conversationId)` block, use:

```ts
    if (message.message_seq > highestContiguousLoadedSeq + 1) {
      store
        .getState()
        .markHistoryBackfillNeeded(conversationId, message.message_seq);
    }
    return;
```

Replace the old `getHighestContiguousMessageSeq` helper with this loaded-window helper:

```ts
function getHighestContiguousLoadedMessageSeq(
  queryClient: QueryClient,
  conversationId: string,
): number {
  const messages = queryClient.getQueryData<ChatMessage[]>(
    imQueryKeys.messages(conversationId),
  );

  if (!messages?.length) {
    return 0;
  }

  const messageSeqs = [
    ...new Set(
      messages
        .filter(isServerSequenced)
        .map((message) => message.message_seq),
    ),
  ]
    .filter((messageSeq) => messageSeq > 0)
    .sort((left, right) => left - right);

  if (messageSeqs.length === 0) {
    return 0;
  }

  let highestContiguousSeq = messageSeqs[0];

  for (let index = 1; index < messageSeqs.length; index += 1) {
    const messageSeq = messageSeqs[index];

    if (messageSeq === highestContiguousSeq + 1) {
      highestContiguousSeq = messageSeq;
      continue;
    }

    if (messageSeq > highestContiguousSeq + 1) {
      break;
    }
  }

  return highestContiguousSeq;
}
```

- [ ] **Step 6: Replace automatic after_seq sync with before_seq backfill in `useConversationMessages.ts`**

In `web/src/features/im/hooks/useConversationMessages.ts`, remove `HISTORY_SYNC_PAGE_SIZE` and use `HISTORY_PAGE_SIZE` for automatic backfill requests.

Rename the marker variables near the top of the hook:

```ts
  const inFlightHistoryBackfillsRef = useRef<Record<string, number>>({});
  const historyBackfillMarker = useImStore((state) =>
    conversationId ? state.historyBackfillMarkers[conversationId] : undefined,
  );
```

In the latest-page merge effect, replace the boolean gap check with a before-seq marker:

```ts
    const backfillBeforeSeq = getBackfillBeforeSeqForLatestPageGap(
      existingMessages,
      fetchedMessages,
    );

    if (backfillBeforeSeq !== null) {
      useImStore
        .getState()
        .markHistoryBackfillNeeded(
          conversation.conversation_id,
          backfillBeforeSeq,
        );
    }
```

Replace the old history sync effect with this before-seq backfill effect:

```ts
  useEffect(() => {
    if (!conversation || !historyBackfillMarker) {
      return;
    }

    const conversationId = conversation.conversation_id;
    const beforeSeq = historyBackfillMarker.before_seq;

    if (inFlightHistoryBackfillsRef.current[conversationId] === beforeSeq) {
      return;
    }

    const existingMessagesBeforeRequest =
      queryClient.getQueryData<ChatMessage[]>(imQueryKeys.messages(conversationId)) ?? [];
    const loadedLowerBoundarySeq = getHighestLoadedMessageSeqBefore(
      existingMessagesBeforeRequest,
      beforeSeq,
    );

    inFlightHistoryBackfillsRef.current[conversationId] = beforeSeq;

    void apiClient
      .listMessages(conversationId, {
        before_seq: beforeSeq,
        limit: HISTORY_PAGE_SIZE,
      })
      .then((backfilledMessages) => {
        queryClient.setQueryData<ChatMessage[]>(
          imQueryKeys.messages(conversationId),
          (existingMessages = []) =>
            mergeMessagesBySeq(existingMessages, backfilledMessages),
        );

        const latestMarker =
          useImStore.getState().historyBackfillMarkers[conversationId];

        if (latestMarker?.before_seq === beforeSeq) {
          const fetchedMinimumSeq = getMinimumMessageSeq(backfilledMessages);

          if (
            backfilledMessages.length >= HISTORY_PAGE_SIZE &&
            Number.isFinite(fetchedMinimumSeq) &&
            !backfillReachedLowerBoundary(
              fetchedMinimumSeq,
              loadedLowerBoundarySeq,
            )
          ) {
            useImStore
              .getState()
              .markHistoryBackfillNeeded(conversationId, fetchedMinimumSeq);
            return;
          }

          useImStore.getState().clearHistoryBackfillMarker(conversationId);
        }
      })
      .catch(() => {
        // Keep the marker so a later render/reconnect can retry the backfill.
      })
      .finally(() => {
        if (inFlightHistoryBackfillsRef.current[conversationId] === beforeSeq) {
          delete inFlightHistoryBackfillsRef.current[conversationId];
        }
      });
  }, [apiClient, conversation, historyBackfillMarker, queryClient]);
```

Replace `latestPageRevealsLoadedMiddleGap` with this helper:

```ts
function getBackfillBeforeSeqForLatestPageGap(
  existingMessages: ChatMessage[],
  fetchedMessages: Message[],
) {
  const highestContiguousLoadedSeq =
    getHighestContiguousLoadedSeq(existingMessages);

  if (highestContiguousLoadedSeq <= 0) {
    return null;
  }

  const fetchedMinimumSeq = getMinimumMessageSeq(fetchedMessages);

  return Number.isFinite(fetchedMinimumSeq) &&
    fetchedMinimumSeq > highestContiguousLoadedSeq + 1
    ? fetchedMinimumSeq
    : null;
}
```

Remove the old `getHighestMessageSeq` helper and add these helpers near the other sequence helpers:

```ts
function getHighestLoadedMessageSeqBefore(
  messages: ChatMessage[],
  beforeSeq: number,
) {
  const seqs = messages
    .map((message) => message.message_seq)
    .filter(
      (messageSeq): messageSeq is number =>
        typeof messageSeq === "number" && messageSeq < beforeSeq,
    );

  if (seqs.length === 0) {
    return 0;
  }

  return Math.max(...seqs);
}

function backfillReachedLowerBoundary(
  fetchedMinimumSeq: number,
  loadedLowerBoundarySeq: number,
) {
  const targetMinimumSeq =
    loadedLowerBoundarySeq > 0 ? loadedLowerBoundarySeq + 1 : 1;

  return fetchedMinimumSeq <= targetMinimumSeq;
}
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```bash
cd web && pnpm test -- src/features/im/state/cacheUpdates.test.ts src/features/im/components/ChatView.test.tsx
```

Expected: PASS. The output should include the `cacheUpdates.test.ts` and `ChatView.test.tsx` suites with no failed tests.

- [ ] **Step 8: Run broader Web verification**

Run:

```bash
cd web && pnpm typecheck && pnpm lint
```

Expected: both commands exit 0. If lint reports line wrapping in the edited code, preserve the same behavior and adjust the wrapping.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add web/src/features/im/state/imStore.ts web/src/features/im/state/cacheUpdates.ts web/src/features/im/state/cacheUpdates.test.ts web/src/features/im/hooks/useConversationMessages.ts web/src/features/im/components/ChatView.test.tsx
git commit -m "fix: backfill message gaps with before seq"
```

Expected: commit succeeds.

---

### Task 2: Document before_seq recovery guidance

**Files:**
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: existing Message History API documentation for `after_seq`, `before_seq`, and `limit`.
- Produces: realtime sync guidance that describes Web automatic gap recovery with `before_seq` backfill and does not instruct Web clients to use forward recovery from the last contiguous sequence for this path.

- [ ] **Step 1: Update realtime sync documentation**

In `docs/api.md`, replace the paragraph under `### Sync and reconnect behavior` with:

```md
Realtime notifications are best-effort and at-most-once. They are not the source of truth: message history and conversation sync APIs remain authoritative. Web clients should track loaded `message_seq` windows per conversation. If a `message.created` event reveals a sequence gap, reconnects occur, or the client suspects missed events, the Web application recovers by paging backward from the upper side of the gap: call `GET /api/v1/conversations/{conversation_id}/messages?before_seq=<gap_upper_seq>&limit=50`, merge the returned messages, and continue with `before_seq=<minimum_seq_from_previous_page>` while full pages still do not reach the already-loaded lower side of the gap. Stop when the page reaches or overlaps existing loaded messages, returns fewer than `limit`, or returns no messages. The API still supports `after_seq` for clients that choose a forward synchronization strategy.
```

- [ ] **Step 2: Verify no stale Web gap-recovery wording remains**

Run:

```bash
rg -n "after_seq=<last_contiguous_seq>|history sync marker|historySyncMarkers|markHistorySyncNeeded|clearHistorySyncMarker" docs/api.md web/src/features/im
```

Expected: no output. If the command finds a stale reference in docs or `web/src/features/im`, update that reference to the new before-seq backfill wording/name.

- [ ] **Step 3: Run final focused verification**

Run:

```bash
cd web && pnpm test -- src/features/im/state/cacheUpdates.test.ts src/features/im/components/ChatView.test.tsx && pnpm typecheck && pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add docs/api.md
git commit -m "docs: describe before-seq gap backfill"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: Task 1 implements before-seq realtime gap markers, latest-page middle-gap backfill, repeated backward backfill, duplicate-fetch preservation, initial latest-page preservation, and manual older-history preservation. Task 2 updates the realtime reconnect guidance that previously instructed clients to use forward recovery from the last contiguous sequence.
- Placeholder scan: this plan contains exact file paths, code snippets, commands, expected outcomes, and no placeholder sections.
- Type consistency: marker names are consistently `HistoryBackfillMarker`, `historyBackfillMarkers`, `markHistoryBackfillNeeded`, and `clearHistoryBackfillMarker`; query payloads use existing `before_seq` and `limit` fields from `MessageHistoryQuery`.
