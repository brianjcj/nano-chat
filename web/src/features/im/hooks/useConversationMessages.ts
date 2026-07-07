import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import type { ConversationSummary, Message } from "@/shared/api/types";
import {
  isServerSequenced,
  mergeMessagesBySeq,
  type ChatMessage,
} from "@/shared/utils/message";

const HISTORY_PAGE_SIZE = 50;

type UseConversationMessagesResult = {
  messages: ChatMessage[];
  isLoading: boolean;
  isFetchingOlder: boolean;
  loadOlder: () => Promise<void>;
  hasLoadedAllKnownHistory: boolean;
  highestContiguousSeq: number;
};

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
  const inFlightHistoryBackfillsRef = useRef<Record<string, number>>({});
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

  const canonicalMessagesQuery = useQuery({
    queryKey: canonicalMessagesKey,
    queryFn: () => Promise.resolve([] as ChatMessage[]),
    enabled: false,
    initialData: () =>
      queryClient.getQueryData<ChatMessage[]>(canonicalMessagesKey) ?? [],
  });

  const latestMessagesQuery = useQuery({
    queryKey: conversation
      ? imQueryKeys.messages(conversation.conversation_id, latestQuery)
      : imQueryKeys.messages("__missing_conversation__", latestQuery),
    queryFn: () =>
      apiClient.listMessages(conversationId, latestQuery) as Promise<Message[]>,
    enabled: Boolean(conversation),
  });

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const nextBeforeSeq = latestMessageSeq + 1;

    queueMicrotask(() => {
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
    });
  }, [conversationId, latestMessageSeq, queryClient]);

  useEffect(() => {
    if (!conversation || !latestMessagesQuery.data) {
      return;
    }

    const fetchedMessages = latestMessagesQuery.data;
    const canonicalMessagesKey = imQueryKeys.messages(
      conversation.conversation_id,
    );
    const existingMessages =
      queryClient.getQueryData<ChatMessage[]>(canonicalMessagesKey) ?? [];

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

    queryClient.setQueryData<ChatMessage[]>(
      canonicalMessagesKey,
      (existingMessages = []) =>
        mergeMessagesBySeq(existingMessages, fetchedMessages),
    );
  }, [conversation, latestMessagesQuery.data, queryClient]);

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
    const loadedLowerBoundarySeq = getLoadedLowerBoundarySeqForBackfill(
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

  const messages = canonicalMessagesQuery.data ?? [];
  const hasLoadedAllKnownHistory = Boolean(
    conversation &&
      (loadedAllHistoryByConversationId[conversation.conversation_id] ||
        conversation.latest_message_seq === 0 ||
        getMinimumMessageSeq(messages) <= 1),
  );

  const loadOlder = useCallback(async () => {
    if (!conversation || isFetchingOlder || hasLoadedAllKnownHistory) {
      return;
    }

    const currentMessages =
      queryClient.getQueryData<ChatMessage[]>(
        imQueryKeys.messages(conversation.conversation_id),
      ) ?? [];
    const beforeSeq = getMinimumMessageSeq(currentMessages);

    if (!Number.isFinite(beforeSeq) || beforeSeq <= 1) {
      markAllHistoryLoaded(
        setLoadedAllHistoryByConversationId,
        conversation.conversation_id,
      );
      return;
    }

    setIsFetchingOlder(true);

    try {
      const olderMessages = await apiClient.listMessages(
        conversation.conversation_id,
        {
          before_seq: beforeSeq,
          limit: HISTORY_PAGE_SIZE,
        },
      );

      queryClient.setQueryData<ChatMessage[]>(
        imQueryKeys.messages(conversation.conversation_id),
        (existingMessages = []) =>
          mergeMessagesBySeq(existingMessages, olderMessages),
      );

      if (
        olderMessages.length < HISTORY_PAGE_SIZE ||
        getMinimumMessageSeq(olderMessages) <= 1
      ) {
        markAllHistoryLoaded(
          setLoadedAllHistoryByConversationId,
          conversation.conversation_id,
        );
      }
    } finally {
      setIsFetchingOlder(false);
    }
  }, [
    apiClient,
    conversation,
    hasLoadedAllKnownHistory,
    isFetchingOlder,
    queryClient,
  ]);

  return {
    messages,
    isLoading: latestMessagesQuery.isLoading && messages.length === 0,
    isFetchingOlder,
    loadOlder,
    hasLoadedAllKnownHistory,
    highestContiguousSeq: getHighestContiguousLoadedSeq(messages),
  };
}

function markAllHistoryLoaded(
  setLoadedAllHistoryByConversationId: Dispatch<
    SetStateAction<Record<string, boolean>>
  >,
  conversationId: string,
) {
  setLoadedAllHistoryByConversationId((loadedAllHistoryByConversationId) => ({
    ...loadedAllHistoryByConversationId,
    [conversationId]: true,
  }));
}

function isMessageSeqLoaded(messages: ChatMessage[], messageSeq: number) {
  if (messageSeq <= 0) {
    return true;
  }

  return messages.some(
    (message) => isServerSequenced(message) && message.message_seq >= messageSeq,
  );
}

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

function getMinimumMessageSeq(messages: ChatMessage[] | Message[]) {
  const seqs = messages
    .map((message) => message.message_seq)
    .filter((messageSeq): messageSeq is number => typeof messageSeq === "number");

  if (seqs.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(...seqs);
}

function getLoadedLowerBoundarySeqForBackfill(
  messages: ChatMessage[],
  beforeSeq: number,
) {
  const seqs = [
    ...new Set(
      messages
        .map((message) => message.message_seq)
        .filter(
          (messageSeq): messageSeq is number =>
            typeof messageSeq === "number" &&
            messageSeq > 0 &&
            messageSeq < beforeSeq,
        ),
    ),
  ].sort((left, right) => left - right);

  if (seqs.length === 0) {
    return 0;
  }

  const loadedSeqs = new Set(seqs);
  let firstMissingBelowHighSide = beforeSeq - 1;

  while (
    firstMissingBelowHighSide > 0 &&
    loadedSeqs.has(firstMissingBelowHighSide)
  ) {
    firstMissingBelowHighSide -= 1;
  }

  if (firstMissingBelowHighSide === 0) {
    return beforeSeq - 1;
  }

  const lowerSideSeqs = seqs.filter(
    (messageSeq) => messageSeq < firstMissingBelowHighSide,
  );

  if (lowerSideSeqs.length === 0) {
    return 0;
  }

  return Math.max(...lowerSideSeqs);
}

function backfillReachedLowerBoundary(
  fetchedMinimumSeq: number,
  loadedLowerBoundarySeq: number,
) {
  const targetMinimumSeq =
    loadedLowerBoundarySeq > 0 ? loadedLowerBoundarySeq + 1 : 1;

  return fetchedMinimumSeq <= targetMinimumSeq;
}

function getHighestContiguousLoadedSeq(messages: ChatMessage[]) {
  const seqs = [
    ...new Set(
      messages.filter(isServerSequenced).map((message) => message.message_seq),
    ),
  ].sort((left, right) => left - right);

  if (seqs.length === 0) {
    return 0;
  }

  let highestContiguousSeq = seqs[0];

  for (let index = 1; index < seqs.length; index += 1) {
    const messageSeq = seqs[index];

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
