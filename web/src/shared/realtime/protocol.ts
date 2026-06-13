import type { ConversationMember, Message } from "@/shared/api/types";

export type ClientCommandType =
  | "message.send"
  | "direct_message.send"
  | "conversation.read"
  | "heartbeat.ping";

export type MessageSendPayload = {
  conversation_id: string;
  client_msg_id: string;
  body: string;
};

type DirectMessageTarget =
  | { target_username: string; target_user_id?: never }
  | { target_username?: never; target_user_id: string };

export type DirectMessageSendPayload = DirectMessageTarget & {
  client_msg_id: string;
  body: string;
};

export type ConversationReadPayload = {
  conversation_id: string;
  read_seq: number;
};

export type HeartbeatPingPayload = {
  client_time: string;
};

export type ClientCommandPayloadByType = {
  "message.send": MessageSendPayload;
  "direct_message.send": DirectMessageSendPayload;
  "conversation.read": ConversationReadPayload;
  "heartbeat.ping": HeartbeatPingPayload;
};

export type RealtimeOutgoing<
  TType extends ClientCommandType = ClientCommandType,
  TPayload = ClientCommandPayloadByType[TType],
> = {
  id?: string;
  type: TType;
  payload: TPayload;
};

export type SendMessageResult = {
  conversation_id: string;
  message: Message;
};

export type ConversationReadResult = {
  conversation_id: string;
  read_seq: number;
};

export type HeartbeatPongPayload = {
  server_time: string;
};

export type RealtimeErrorPayload = {
  code: string;
  message: string;
};

export type MessageCreatedEvent = {
  type: "message.created";
  payload: {
    conversation_id: string;
    message: Message;
  };
};

export type ConversationReadUpdatedEvent = {
  type: "conversation.read_updated";
  payload: {
    conversation_id: string;
    user_id: string;
    read_seq: number;
  };
};

export type ConversationMemberAddedEvent = {
  type: "conversation.member_added";
  payload: {
    conversation_id: string;
    member: ConversationMember;
  };
};

export type ConversationMemberLeftEvent = {
  type: "conversation.member_left";
  payload: {
    conversation_id: string;
    user_id: string;
  };
};

export type ConversationDissolvedEvent = {
  type: "conversation.dissolved";
  payload: {
    conversation_id: string;
    user_id: string;
  };
};

export type ServerDrainingEvent = {
  type: "server.draining";
  payload?: {
    retry_after_ms?: number;
  };
};

export type RealtimeServerEvent =
  | MessageCreatedEvent
  | ConversationReadUpdatedEvent
  | ConversationMemberAddedEvent
  | ConversationMemberLeftEvent
  | ConversationDissolvedEvent
  | ServerDrainingEvent;

export type CommandOkEnvelope<TPayload = unknown> = {
  id?: string;
  type: `${string}.ok`;
  payload: TPayload;
};

export type HeartbeatPongEnvelope = {
  id?: string;
  type: "heartbeat.pong";
  payload: HeartbeatPongPayload;
};

export type RealtimeErrorEnvelope = {
  id?: string;
  type: "error";
  error: RealtimeErrorPayload;
};

export type RealtimeIncoming =
  | RealtimeServerEvent
  | CommandOkEnvelope
  | HeartbeatPongEnvelope
  | RealtimeErrorEnvelope;
