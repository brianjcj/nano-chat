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
  currentUserId?: string | null;
  event: RealtimeIncoming;
};

export function applyRealtimeEvent({
  queryClient,
  store = useImStore,
  currentUserId,
  event,
}: ApplyRealtimeEventOptions): void {
  switch (event.type) {
    case "message.created":
      applyMessageCreated(queryClient, store, currentUserId, event);
      return;
    case "conversation.read_updated":
      applyConversationReadUpdated(queryClient, store, currentUserId, event);
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
  currentUserId: string | null | undefined,
  event: MessageCreatedEvent,
): void {
  const { conversation_id: conversationId, message } = event.payload;
  const currentConversationId = store.getState().currentConversationId;
  const highestContiguousSeq = getHighestContiguousMessageSeq(
    queryClient,
    conversationId,
  );
  const isAlreadyKnown = isMessageAlreadyKnown(
    queryClient,
    conversationId,
    message,
  );

  updateConversationLatestMessage(queryClient, conversationId, message);
  upsertMessageInCanonicalCache(queryClient, conversationId, message);

  if (currentConversationId === conversationId) {
    if (message.message_seq > highestContiguousSeq + 1) {
      store
        .getState()
        .markHistorySyncNeeded(conversationId, highestContiguousSeq);
    }
    return;
  }

  if (isAlreadyKnown || message.sender.user_id === currentUserId) {
    return;
  }

  store.getState().incrementUnreadCorrection(conversationId);
}

function applyConversationReadUpdated(
  queryClient: QueryClient,
  store: ImStoreApi,
  currentUserId: string | null | undefined,
  event: ConversationReadUpdatedEvent,
): void {
  const {
    conversation_id: conversationId,
    read_seq: readSeq,
    user_id: userId,
  } = event.payload;

  if (userId !== currentUserId) {
    return;
  }

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

  store.getState().clearUnreadCorrection(conversationId);
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

      return conversations
        .map((conversation) => {
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
        })
        .sort(compareConversationLatestMessage);
    },
  );
}

function upsertMessageInCanonicalCache(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
): void {
  const canonicalMessagesKey = imQueryKeys.messages(conversationId);
  const existingMessages = queryClient.getQueryData<Message[]>(
    canonicalMessagesKey,
  );

  // The base messages key is the canonical loaded-message cache. Query-specific
  // history page keys are authoritative fetch pages and realtime events must not
  // mutate them because the incoming message may not belong to that page.
  if (existingMessages === undefined) {
    return;
  }

  queryClient.setQueryData<Message[]>(
    canonicalMessagesKey,
    insertMessage(existingMessages, message),
  );
}

function insertMessage(messages: Message[], message: Message) {
  if (
    messages.some(
      (existingMessage) =>
        existingMessage.message_id === message.message_id ||
        existingMessage.message_seq === message.message_seq,
    )
  ) {
    return [...messages].sort(compareMessageSeq);
  }

  return [...messages, message].sort(compareMessageSeq);
}

function isMessageAlreadyKnown(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
) {
  return (
    isMessageInCanonicalCache(queryClient, conversationId, message) ||
    isMessageCoveredByConversationSummary(queryClient, conversationId, message)
  );
}

function isMessageInCanonicalCache(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
) {
  const messages = queryClient.getQueryData<Message[]>(
    imQueryKeys.messages(conversationId),
  );

  return Boolean(
    messages?.some(
      (existingMessage) =>
        existingMessage.message_id === message.message_id ||
        existingMessage.message_seq === message.message_seq,
    ),
  );
}

function isMessageCoveredByConversationSummary(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
) {
  const conversations = queryClient.getQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
  );
  const conversation = conversations?.find(
    (candidate) => candidate.conversation_id === conversationId,
  );

  return Boolean(
    conversation &&
      (conversation.latest_message?.message_id === message.message_id ||
        conversation.latest_message_seq >= message.message_seq),
  );
}

function getHighestContiguousMessageSeq(
  queryClient: QueryClient,
  conversationId: string,
): number {
  const messages = queryClient.getQueryData<Message[]>(
    imQueryKeys.messages(conversationId),
  );

  if (!messages?.length) {
    return 0;
  }

  const messageSeqs = [...new Set(messages.map((message) => message.message_seq))]
    .filter((messageSeq) => messageSeq > 0)
    .sort((left, right) => left - right);
  let highestContiguousSeq = 0;

  for (const messageSeq of messageSeqs) {
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

function toLatestMessage(message: Message): ConversationSummary["latest_message"] {
  return {
    message_id: message.message_id,
    message_seq: message.message_seq,
    sender: message.sender,
    body: message.body,
    created_at: message.created_at,
  };
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

  const latestSeqComparison = right.latest_message_seq - left.latest_message_seq;

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

function compareMessageSeq(left: Message, right: Message) {
  return left.message_seq - right.message_seq;
}
