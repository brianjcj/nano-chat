import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
import type { DirectDraft } from "@/features/im/state/imStore";
import type { ConversationSummary, Message } from "@/shared/api/types";
import { useRealtimeClient } from "@/shared/realtime/RealtimeClientContext";
import type { SendMessageResult } from "@/shared/realtime/protocol";
import {
  createClientMsgId,
  mergeMessagesBySeq,
  validateMessageBody,
  type ChatMessage,
  type MessageValidationResult,
  type OptimisticChatMessage,
} from "@/shared/utils/message";

type SendMessageOptions = {
  clientMsgId?: string;
};

export type SendMessageOutcome = MessageValidationResult | { ok: false; code: "send_failed" };

type UseSendMessageResult = {
  sendMessage: (
    body: string,
    options?: SendMessageOptions,
  ) => Promise<SendMessageOutcome>;
  retryMessage: (message: ChatMessage) => Promise<SendMessageOutcome>;
};

type MessageValidationFailure = Extract<MessageValidationResult, { ok: false }>;

export type DirectDraftSendOutcome =
  | MessageValidationFailure
  | { ok: false; code: "send_failed" }
  | { ok: true; conversationId: string; message: Message };

type UseSendDirectDraftMessageResult = {
  sendMessage: (body: string) => Promise<DirectDraftSendOutcome>;
};

export function useSendMessage(
  conversation: ConversationSummary,
): UseSendMessageResult {
  const queryClient = useQueryClient();
  const realtimeClient = useRealtimeClient();
  const { getValidSession } = useSession();

  const sendMessage = useCallback(
    async (body: string, options: SendMessageOptions = {}) => {
      const validation = validateMessageBody(body);

      if (!validation.ok) {
        return validation;
      }

      const session = getValidSession();

      if (!session) {
        return { ok: false, code: "send_failed" } as const;
      }

      const clientMsgId = options.clientMsgId ?? createClientMsgId();
      const optimisticMessage = createOptimisticMessage({
        body,
        clientMsgId,
        conversationId: conversation.conversation_id,
        sender: session.user,
        status: "pending",
      });

      queryClient.setQueryData<ChatMessage[]>(
        imQueryKeys.messages(conversation.conversation_id),
        (messages = []) => mergeMessagesBySeq(messages, [optimisticMessage]),
      );

      try {
        const result = await realtimeClient.sendCommand<
          "message.send",
          SendMessageResult
        >("message.send", {
          conversation_id: conversation.conversation_id,
          client_msg_id: clientMsgId,
          body,
        });

        replacePendingMessage(
          queryClient,
          conversation.conversation_id,
          clientMsgId,
          result.message,
        );
        updateConversationLatestMessage(
          queryClient,
          conversation.conversation_id,
          result.message,
        );

        return { ok: true } as const;
      } catch {
        markPendingMessageFailed(queryClient, conversation.conversation_id, clientMsgId);

        return { ok: false, code: "send_failed" } as const;
      }
    },
    [conversation.conversation_id, getValidSession, queryClient, realtimeClient],
  );

  const retryMessage = useCallback(
    (message: ChatMessage) => {
      if (!message.client_msg_id) {
        return Promise.resolve({ ok: false, code: "send_failed" } as const);
      }

      return sendMessage(message.body, { clientMsgId: message.client_msg_id });
    },
    [sendMessage],
  );

  return { sendMessage, retryMessage };
}

export function useSendDirectDraftMessage(
  draft: DirectDraft | null,
): UseSendDirectDraftMessageResult {
  const queryClient = useQueryClient();
  const realtimeClient = useRealtimeClient();
  const { getValidSession } = useSession();

  const sendMessage = useCallback(
    async (body: string) => {
      const validation = validateMessageBody(body);

      if (!validation.ok) {
        return validation;
      }

      const session = getValidSession();

      if (!session || !draft?.target_username) {
        return { ok: false, code: "send_failed" } as const;
      }

      const clientMsgId = createClientMsgId();
      const target = draft.target_user_id
        ? { target_user_id: draft.target_user_id }
        : { target_username: draft.target_username };

      try {
        const result = await realtimeClient.sendCommand<
          "direct_message.send",
          SendMessageResult
        >("direct_message.send", {
          ...target,
          client_msg_id: clientMsgId,
          body,
        });

        queryClient.setQueryData<ChatMessage[]>(
          imQueryKeys.messages(result.conversation_id),
          (messages = []) => mergeMessagesBySeq(messages, [result.message]),
        );
        void queryClient.invalidateQueries({
          queryKey: imQueryKeys.conversations(),
        });

        return {
          ok: true,
          conversationId: result.conversation_id,
          message: result.message,
        } as const;
      } catch {
        return { ok: false, code: "send_failed" } as const;
      }
    },
    [draft, getValidSession, queryClient, realtimeClient],
  );

  return { sendMessage };
}

function createOptimisticMessage({
  body,
  clientMsgId,
  conversationId,
  sender,
  status,
}: {
  body: string;
  clientMsgId: string;
  conversationId: string;
  sender: OptimisticChatMessage["sender"];
  status: OptimisticChatMessage["delivery_status"];
}): OptimisticChatMessage {
  return {
    message_id: `client:${clientMsgId}`,
    conversation_id: conversationId,
    message_seq: null,
    sender,
    body,
    created_at: new Date().toISOString(),
    client_msg_id: clientMsgId,
    delivery_status: status,
  };
}

function replacePendingMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  clientMsgId: string,
  serverMessage: Message,
) {
  queryClient.setQueryData<ChatMessage[]>(
    imQueryKeys.messages(conversationId),
    (messages = []) =>
      mergeMessagesBySeq(
        messages.filter((message) => message.client_msg_id !== clientMsgId),
        [serverMessage],
      ),
  );
}

function markPendingMessageFailed(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  clientMsgId: string,
) {
  queryClient.setQueryData<ChatMessage[]>(
    imQueryKeys.messages(conversationId),
    (messages = []) =>
      messages.map((message) =>
        message.client_msg_id === clientMsgId && message.message_seq === null
          ? { ...message, delivery_status: "failed" as const }
          : message,
      ),
  );
}

function updateConversationLatestMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: Message,
) {
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
            latest_message: {
              message_id: message.message_id,
              message_seq: message.message_seq,
              sender: message.sender,
              body: message.body,
              created_at: message.created_at,
            },
          };
        })
        .sort(compareConversationLatestMessage);
    },
  );
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
