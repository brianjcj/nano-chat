import type { Message, UserSummary } from "@/shared/api/types";

export const DEFAULT_MESSAGE_MAX_BYTES = 4096;

export type ServerChatMessage = Message & {
  client_msg_id?: string;
  delivery_status?: "sent";
};

export type OptimisticChatMessage = {
  message_id: string;
  conversation_id: string;
  message_seq: null;
  sender: UserSummary;
  body: string;
  created_at: string;
  client_msg_id: string;
  delivery_status: "pending" | "failed";
  error_code?: string;
};

export type ChatMessage = ServerChatMessage | OptimisticChatMessage;

export type MessageValidationResult =
  | { ok: true }
  | { ok: false; code: "empty_message" | "message_too_large" };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateMessageBody(
  body: string,
  maxBytes = DEFAULT_MESSAGE_MAX_BYTES,
): MessageValidationResult {
  if (body.trim().length === 0) {
    return { ok: false, code: "empty_message" };
  }

  if (utf8ByteLength(body) > maxBytes) {
    return { ok: false, code: "message_too_large" };
  }

  return { ok: true };
}

export function createClientMsgId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const random = Math.random().toString(36).slice(2, 12);

  return `client-${Date.now().toString(36)}-${random}`;
}

export function mergeMessagesBySeq(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const merged = [...existing];

  for (const incomingMessage of incoming) {
    const existingIndex = merged.findIndex((candidate) =>
      isSameMessage(candidate, incomingMessage),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = incomingMessage;
      continue;
    }

    merged.push(incomingMessage);
  }

  return merged.sort(compareChatMessages);
}

function isSameMessage(left: ChatMessage, right: ChatMessage) {
  if (left.client_msg_id && right.client_msg_id) {
    return left.client_msg_id === right.client_msg_id;
  }

  if (left.message_id && right.message_id && left.message_id === right.message_id) {
    return true;
  }

  return (
    left.conversation_id === right.conversation_id &&
    isServerSequenced(left) &&
    isServerSequenced(right) &&
    left.message_seq === right.message_seq
  );
}

export function isServerSequenced(
  message: ChatMessage,
): message is ServerChatMessage {
  return typeof message.message_seq === "number";
}

function compareChatMessages(left: ChatMessage, right: ChatMessage) {
  if (isServerSequenced(left) && isServerSequenced(right)) {
    return left.message_seq - right.message_seq;
  }

  if (isServerSequenced(left) !== isServerSequenced(right)) {
    return isServerSequenced(left) ? -1 : 1;
  }

  const createdAtComparison =
    Date.parse(left.created_at) - Date.parse(right.created_at);

  if (Number.isFinite(createdAtComparison) && createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return (left.client_msg_id ?? left.message_id).localeCompare(
    right.client_msg_id ?? right.message_id,
  );
}
