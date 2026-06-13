import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "@/app/AppProviders";
import type { MessageHistoryQuery } from "@/shared/api/types";

export const imQueryKeys = {
  all: ["im"] as const,
  conversations: () => [...imQueryKeys.all, "conversations"] as const,
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

  return useQuery({
    queryKey: imQueryKeys.conversations(),
    queryFn: () => apiClient.listConversations(),
  });
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
