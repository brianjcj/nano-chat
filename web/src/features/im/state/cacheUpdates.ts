import type { QueryClient } from "@tanstack/react-query";

import { imQueryKeys } from "../api/imQueries";
import { useImStore, type ImStoreApi } from "./imStore";
import type { ConversationSummary, Message } from "@/shared/api/types";
import type {
  ConversationDissolvedEvent,
  ConversationMemberAddedEvent,
  ConversationMemberLeftEvent,
  ConversationReadUpdatedEvent,
  MessageCreatedEvent,
  RealtimeIncoming,
} from "@/shared/realtime/protocol";

type ApplyRealtimeEventOptions = {
  queryClient: QueryClient;
  store?: ImStoreApi;
  event: RealtimeIncoming;
};

export function applyRealtimeEvent({
  queryClient,
  store = useImStore,
  event,
}: ApplyRealtimeEventOptions): void {
  switch (event.type) {
    case "message.created":
      applyMessageCreated(queryClient, store, event);
      return;
    case "conversation.read_updated":
      applyConversationReadUpdated(queryClient, store, event);
      return;
    case "conversation.member_added":
      invalidateMembershipQueries(queryClient, event);
      return;
    case "conversation.member_left":
      invalidateMembershipQueries(queryClient, event);
      return;
    case "conversation.dissolved":
      applyConversationDissolved(queryClient, event);
      return;
    case "server.draining":
      store.getState().setRealtimeStatus("draining");
      return;
    default:
      return;
  }
}

function applyMessageCreated(
  queryClient: QueryClient,
  store: ImStoreApi,
  event: MessageCreatedEvent,
): void {
  const { conversation_id: conversationId, message } = event.payload;
  const currentConversationId = store.getState().currentConversationId;
  const highestKnownSeq = getHighestKnownMessageSeq(queryClient, conversationId);

  updateConversationLatestMessage(queryClient, conversationId, message);
  upsertMessageInCaches(queryClient, conversationId, message);

  if (currentConversationId === conversationId) {
    if (message.message_seq > highestKnownSeq + 1) {
      store
        .getState()
        .markHistorySyncNeeded(conversationId, Math.max(highestKnownSeq, 0));
    }
    return;
  }

  store.getState().incrementUnreadCorrection(conversationId);
}

function applyConversationReadUpdated(
  queryClient: QueryClient,
  store: ImStoreApi,
  event: ConversationReadUpdatedEvent,
): void {
  const { conversation_id: conversationId, read_seq: readSeq } = event.payload;

  queryClient.setQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
    (conversations) =>
      conversations?.map((conversation) => {
        if (conversation.conversation_id !== conversationId) {
          return conversation;
        }

        const nextReadSeq = Math.max(conversation.read_seq, readSeq);
        const unreadCount = Math.max(
          0,
          conversation.latest_message_seq - nextReadSeq,
        );

        return {
          ...conversation,
          read_seq: nextReadSeq,
          unread_count: unreadCount,
        };
      }),
  );

  if (store.getState().currentConversationId === conversationId) {
    store.getState().clearUnreadCorrection(conversationId);
  }
}

function invalidateMembershipQueries(
  queryClient: QueryClient,
  event: ConversationMemberAddedEvent | ConversationMemberLeftEvent,
): void {
  void queryClient.invalidateQueries({ queryKey: imQueryKeys.conversations() });
  void queryClient.invalidateQueries({
    queryKey: imQueryKeys.members(event.payload.conversation_id),
  });
}

function applyConversationDissolved(
  queryClient: QueryClient,
  event: ConversationDissolvedEvent,
): void {
  const conversationId = event.payload.conversation_id;

  queryClient.setQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
    (conversations) =>
      conversations?.map((conversation) =>
        conversation.conversation_id === conversationId
          ? { ...conversation, state: "dissolved" }
          : conversation,
      ),
  );
  void queryClient.invalidateQueries({
    queryKey: imQueryKeys.members(conversationId),
  });
}

function updateConversationLatestMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
): void {
  queryClient.setQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
    (conversations) => {
      if (!conversations) {
        return conversations;
      }

      return conversations.map((conversation) => {
        if (conversation.conversation_id !== conversationId) {
          return conversation;
        }

        if (message.message_seq < conversation.latest_message_seq) {
          return conversation;
        }

        return {
          ...conversation,
          latest_message_seq: message.message_seq,
          latest_message: toLatestMessage(message),
        };
      });
    },
  );
}

function upsertMessageInCaches(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
): void {
  const defaultMessagesKey = imQueryKeys.messages(conversationId);

  queryClient.setQueryData<Message[]>(defaultMessagesKey, (messages) =>
    insertMessage(messages, message),
  );
  queryClient.setQueriesData<Message[]>(
    { queryKey: defaultMessagesKey },
    (messages) => insertMessage(messages, message),
  );
}

function insertMessage(messages: Message[] | undefined, message: Message) {
  const existingMessages = messages ?? [];

  if (
    existingMessages.some(
      (existingMessage) =>
        existingMessage.message_id === message.message_id ||
        existingMessage.message_seq === message.message_seq,
    )
  ) {
    return [...existingMessages].sort(compareMessageSeq);
  }

  return [...existingMessages, message].sort(compareMessageSeq);
}

function getHighestKnownMessageSeq(
  queryClient: QueryClient,
  conversationId: string,
): number {
  const messageCaches = queryClient.getQueriesData<Message[]>({
    queryKey: imQueryKeys.messages(conversationId),
  });

  return messageCaches.reduce((highestSeq, [, messages]) => {
    if (!messages) {
      return highestSeq;
    }

    return messages.reduce(
      (messageHighestSeq, message) =>
        Math.max(messageHighestSeq, message.message_seq),
      highestSeq,
    );
  }, 0);
}

function toLatestMessage(message: Message): ConversationSummary["latest_message"] {
  return {
    message_id: message.message_id,
    message_seq: message.message_seq,
    sender: message.sender,
    body: message.body,
    created_at: message.created_at,
  };
}

function compareMessageSeq(left: Message, right: Message) {
  return left.message_seq - right.message_seq;
}
