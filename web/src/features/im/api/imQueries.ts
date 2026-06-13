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
    return sortConversationsByLatestMessage(conversations);
  }

  const currentById = new Map(
    currentConversations.map((conversation) => [
      conversation.conversation_id,
      conversation,
    ]),
  );

  return sortConversationsByLatestMessage(
    conversations.map((conversation) => {
      const currentConversation = currentById.get(conversation.conversation_id);

      if (!currentConversation) {
        return conversation;
      }

      const currentHasNewerLatestMessage = hasNewerLatestMessage(
        currentConversation,
        conversation,
      );
      const shouldPreserveCurrentReadState =
        currentHasNewerLatestMessage ||
        currentConversation.read_seq > conversation.read_seq;
      const latestMessageSeq = Math.max(
        conversation.latest_message_seq,
        currentConversation.latest_message_seq,
      );
      const latestMessage = currentHasNewerLatestMessage
        ? currentConversation.latest_message
        : conversation.latest_message;
      const readSeq = shouldPreserveCurrentReadState
        ? currentConversation.read_seq
        : conversation.read_seq;
      let unreadCount = conversation.unread_count;
      if (currentHasNewerLatestMessage) {
        unreadCount = currentConversation.unread_count;
      } else if (shouldPreserveCurrentReadState) {
        unreadCount = Math.max(0, latestMessageSeq - readSeq);
      }

      if (
        latestMessageSeq === conversation.latest_message_seq &&
        latestMessage === conversation.latest_message &&
        readSeq === conversation.read_seq &&
        unreadCount === conversation.unread_count
      ) {
        return conversation;
      }

      return {
        ...conversation,
        latest_message_seq: latestMessageSeq,
        latest_message: latestMessage,
        read_seq: readSeq,
        unread_count: unreadCount,
      };
    }),
  );
}

function hasNewerLatestMessage(
  candidate: ConversationSummary,
  baseline: ConversationSummary,
) {
  if (candidate.latest_message_seq > baseline.latest_message_seq) {
    return true;
  }

  return (
    getLatestVisibleMessageSeq(candidate) > getLatestVisibleMessageSeq(baseline)
  );
}

function getLatestVisibleMessageSeq(conversation: ConversationSummary) {
  return conversation.latest_message?.message_seq ?? 0;
}

function sortConversationsByLatestMessage(
  conversations: ConversationSummary[],
) {
  return [...conversations].sort(compareConversationLatestMessage);
}

function compareConversationLatestMessage(
  left: ConversationSummary,
  right: ConversationSummary,
) {
  const leftHasLatestMessage = Boolean(left.latest_message);
  const rightHasLatestMessage = Boolean(right.latest_message);

  if (leftHasLatestMessage !== rightHasLatestMessage) {
    return leftHasLatestMessage ? -1 : 1;
  }

  if (!leftHasLatestMessage && !rightHasLatestMessage) {
    return 0;
  }

  const leftCreatedAt = parseLatestMessageCreatedAt(left);
  const rightCreatedAt = parseLatestMessageCreatedAt(right);

  if (
    leftCreatedAt !== null &&
    rightCreatedAt !== null &&
    leftCreatedAt !== rightCreatedAt
  ) {
    return rightCreatedAt - leftCreatedAt;
  }

  const latestSeqComparison =
    getLatestVisibleMessageSeq(right) - getLatestVisibleMessageSeq(left);

  if (latestSeqComparison !== 0) {
    return latestSeqComparison;
  }

  return 0;
}

function parseLatestMessageCreatedAt(conversation: ConversationSummary) {
  const createdAt = conversation.latest_message?.created_at;

  if (!createdAt) {
    return null;
  }

  const timestamp = Date.parse(createdAt);

  return Number.isFinite(timestamp) ? timestamp : null;
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
