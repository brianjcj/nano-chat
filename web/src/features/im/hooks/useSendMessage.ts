import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
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
    (conversations) =>
      conversations?.map((conversation) => {
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
      }),
  );
}
