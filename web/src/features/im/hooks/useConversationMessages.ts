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
const HISTORY_SYNC_PAGE_SIZE = 100;

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
  const canonicalMessagesKey = imQueryKeys.messages(conversationId);
  const [isFetchingOlder, setIsFetchingOlder] = useState(false);
  const [loadedAllHistoryByConversationId, setLoadedAllHistoryByConversationId] =
    useState<Record<string, boolean>>({});
  const inFlightHistorySyncsRef = useRef<Record<string, number>>({});
  const historySyncMarker = useImStore((state) =>
    conversationId ? state.historySyncMarkers[conversationId] : undefined,
  );

  const latestQuery = useMemo(
    () => ({
      before_seq: (conversation?.latest_message_seq ?? 0) + 1,
      limit: HISTORY_PAGE_SIZE,
    }),
    [conversation?.latest_message_seq],
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
    if (!conversation || !latestMessagesQuery.data) {
      return;
    }

    const fetchedMessages = latestMessagesQuery.data;
    const canonicalMessagesKey = imQueryKeys.messages(
      conversation.conversation_id,
    );
    const existingMessages =
      queryClient.getQueryData<ChatMessage[]>(canonicalMessagesKey) ?? [];

    if (latestPageRevealsLoadedMiddleGap(existingMessages, fetchedMessages)) {
      useImStore
        .getState()
        .markHistorySyncNeeded(
          conversation.conversation_id,
          getHighestContiguousLoadedSeq(existingMessages),
        );
    }

    queryClient.setQueryData<ChatMessage[]>(
      canonicalMessagesKey,
      (existingMessages = []) =>
        mergeMessagesBySeq(existingMessages, fetchedMessages),
    );
  }, [conversation, latestMessagesQuery.data, queryClient]);

  useEffect(() => {
    if (!conversation || !historySyncMarker) {
      return;
    }

    const conversationId = conversation.conversation_id;
    const afterSeq = historySyncMarker.after_seq;

    if (inFlightHistorySyncsRef.current[conversationId] === afterSeq) {
      return;
    }

    inFlightHistorySyncsRef.current[conversationId] = afterSeq;

    void apiClient
      .listMessages(conversationId, {
        after_seq: afterSeq,
        limit: HISTORY_SYNC_PAGE_SIZE,
      })
      .then((syncedMessages) => {
        queryClient.setQueryData<ChatMessage[]>(
          imQueryKeys.messages(conversationId),
          (existingMessages = []) =>
            mergeMessagesBySeq(existingMessages, syncedMessages),
        );

        const latestMarker =
          useImStore.getState().historySyncMarkers[conversationId];

        if (latestMarker?.after_seq === afterSeq) {
          const highestSyncedSeq = getHighestMessageSeq(syncedMessages);

          if (
            syncedMessages.length >= HISTORY_SYNC_PAGE_SIZE &&
            highestSyncedSeq > afterSeq
          ) {
            useImStore
              .getState()
              .markHistorySyncNeeded(conversationId, highestSyncedSeq);
            return;
          }

          useImStore.getState().clearHistorySyncMarker(conversationId);
        }
      })
      .catch(() => {
        // Keep the marker so a later render/reconnect can retry the sync.
      })
      .finally(() => {
        if (inFlightHistorySyncsRef.current[conversationId] === afterSeq) {
          delete inFlightHistorySyncsRef.current[conversationId];
        }
      });
  }, [apiClient, conversation, historySyncMarker, queryClient]);

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

function latestPageRevealsLoadedMiddleGap(
  existingMessages: ChatMessage[],
  fetchedMessages: Message[],
) {
  const highestContiguousLoadedSeq =
    getHighestContiguousLoadedSeq(existingMessages);

  if (highestContiguousLoadedSeq <= 0) {
    return false;
  }

  const fetchedMinimumSeq = getMinimumMessageSeq(fetchedMessages);

  return (
    Number.isFinite(fetchedMinimumSeq) &&
    fetchedMinimumSeq > highestContiguousLoadedSeq + 1
  );
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

function getHighestMessageSeq(messages: ChatMessage[] | Message[]) {
  const seqs = messages
    .map((message) => message.message_seq)
    .filter((messageSeq): messageSeq is number => typeof messageSeq === "number");

  if (seqs.length === 0) {
    return 0;
  }

  return Math.max(...seqs);
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
