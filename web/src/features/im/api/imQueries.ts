import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "@/app/AppProviders";
import { useImStore } from "@/features/im/state/imStore";
import type { ConversationSummary, MessageHistoryQuery } from "@/shared/api/types";

export const imQueryKeys = {
  all: ["im"] as const,
  conversations: () => [...imQueryKeys.all, "conversations"] as const,
  // imQueryKeys.messages(conversationId) is the canonical loaded-message cache.
  // Query-specific message keys are authoritative fetch pages and should not be
  // mutated by realtime events.
  messages: (conversationId: string, query?: MessageHistoryQuery) =>
    query
      ? ([
          ...imQueryKeys.all,
          "messages",
          conversationId,
          normalizeMessageHistoryQuery(query),
        ] as const)
      : ([...imQueryKeys.all, "messages", conversationId] as const),
  members: (conversationId: string) =>
    [...imQueryKeys.all, "members", conversationId] as const,
};

export function useConversationsQuery() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: imQueryKeys.conversations(),
    queryFn: async () => {
      const conversations = await apiClient.listConversations();
      const currentConversations = queryClient.getQueryData<
        ConversationSummary[]
      >(imQueryKeys.conversations());

      // Reconcile against raw backend data; the monotonic merge may preserve
      // realtime-only state that does not prove the backend has caught up.
      reconcileUnreadCorrections(conversations);

      return mergeConversationsMonotonically(
        conversations,
        currentConversations,
      );
    },
  });
}

function reconcileUnreadCorrections(conversations: ConversationSummary[]) {
  const store = useImStore.getState();
  const currentCorrections = store.unreadCorrections;
  const correctionMaxMessageSeqs = store.unreadCorrectionMaxMessageSeqs;

  for (const conversation of conversations) {
    const conversationId = conversation.conversation_id;

    if (
      Object.prototype.hasOwnProperty.call(currentCorrections, conversationId) &&
      conversation.latest_message_seq >=
        (correctionMaxMessageSeqs[conversationId] ?? 0)
    ) {
      store.clearUnreadCorrection(conversationId);
    }
  }
}

function mergeConversationsMonotonically(
  conversations: ConversationSummary[],
  currentConversations: ConversationSummary[] | undefined,
) {
  if (!currentConversations?.length) {
    return conversations;
  }

  const currentById = new Map(
    currentConversations.map((conversation) => [
      conversation.conversation_id,
      conversation,
    ]),
  );

  return conversations.map((conversation) => {
    const currentConversation = currentById.get(conversation.conversation_id);

    if (!currentConversation) {
      return conversation;
    }

    const latestMessageSeq = Math.max(
      conversation.latest_message_seq,
      currentConversation.latest_message_seq,
    );
    const latestMessage = getMonotonicLatestMessage(
      conversation,
      currentConversation,
    );

    if (
      latestMessageSeq === conversation.latest_message_seq &&
      latestMessage === conversation.latest_message
    ) {
      return conversation;
    }

    return {
      ...conversation,
      latest_message_seq: latestMessageSeq,
      latest_message: latestMessage,
    };
  });
}

function getMonotonicLatestMessage(
  conversation: ConversationSummary,
  currentConversation: ConversationSummary,
) {
  const currentLatestMessageSeq =
    currentConversation.latest_message?.message_seq ?? 0;
  const fetchedLatestMessageSeq = conversation.latest_message?.message_seq ?? 0;

  if (currentLatestMessageSeq > fetchedLatestMessageSeq) {
    return currentConversation.latest_message;
  }

  return conversation.latest_message;
}

export function useMessagesQuery(
  conversationId: string,
  query?: MessageHistoryQuery,
) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: imQueryKeys.messages(conversationId, query),
    queryFn: () => apiClient.listMessages(conversationId, query),
    enabled: Boolean(conversationId),
  });
}

export function useMembersQuery(conversationId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: imQueryKeys.members(conversationId),
    queryFn: () => apiClient.listMembers(conversationId),
    enabled: Boolean(conversationId),
  });
}

function normalizeMessageHistoryQuery(query: MessageHistoryQuery) {
  return {
    after_seq: query.after_seq ?? null,
    before_seq: query.before_seq ?? null,
    limit: query.limit ?? null,
  };
}
