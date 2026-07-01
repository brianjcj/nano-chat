import type {
  CallEndReason,
  CallMediaType,
  ConversationMember,
  Message,
  UserSummary,
} from "@/shared/api/types";

export type ClientCommandType =
  | "message.send"
  | "direct_message.send"
  | "conversation.read"
  | "heartbeat.ping"
  | "call.invite"
  | "call.accept"
  | "call.connected"
  | "call.reject"
  | "call.cancel"
  | "call.hangup"
  | "call.signal";

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

export type CallInvitePayload = {
  conversation_id: string;
  media_type: CallMediaType;
};

export type CallIdPayload = {
  call_id: string;
};

export type CallHangupPayload = {
  call_id: string;
  reason?: CallEndReason;
};

export type CallSignalPayload = {
  call_id: string;
  signal_type: "offer" | "answer" | "ice_candidate";
  data: unknown;
};

export type ClientCommandPayloadByType = {
  "message.send": MessageSendPayload;
  "direct_message.send": DirectMessageSendPayload;
  "conversation.read": ConversationReadPayload;
  "heartbeat.ping": HeartbeatPingPayload;
  "call.invite": CallInvitePayload;
  "call.accept": CallIdPayload;
  "call.connected": CallIdPayload;
  "call.reject": CallIdPayload;
  "call.cancel": CallIdPayload;
  "call.hangup": CallHangupPayload;
  "call.signal": CallSignalPayload;
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

export type CallSummary = {
  call_id: string;
  conversation_id: string;
  caller: UserSummary;
  callee: UserSummary;
  caller_client_id: string;
  accepted_client_id: string | null;
  media_type: "audio" | "video";
  state: "ringing" | "connecting" | "active" | "ended";
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  end_reason: CallEndReason | null;
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

export type CallStateEventType =
  | "call.incoming"
  | "call.ringing"
  | "call.accepted"
  | "call.connected"
  | "call.rejected"
  | "call.canceled"
  | "call.ended"
  | "call.busy";

export type CallStateEvent = {
  type: CallStateEventType;
  payload: {
    call: CallSummary;
  };
};

export type CallSignalEvent = {
  type: "call.signal";
  payload: CallSignalPayload;
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
  | CallStateEvent
  | CallSignalEvent
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
