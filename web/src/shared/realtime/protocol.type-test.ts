import type {
  CallHangupPayload,
  CallIdPayload,
  CallInvitePayload,
  CallSignalPayload,
  CallSummary,
  DirectMessageSendPayload,
  MessageSendPayload,
  RealtimeServerEvent,
} from "./protocol";

function expectMessageSendPayload(payload: MessageSendPayload) {
  void payload;
}

function expectDirectMessageSendPayload(payload: DirectMessageSendPayload) {
  void payload;
}

function expectCallInvitePayload(payload: CallInvitePayload) {
  void payload;
}

function expectCallIdPayload(payload: CallIdPayload) {
  void payload;
}

function expectCallHangupPayload(payload: CallHangupPayload) {
  void payload;
}

function expectCallSignalPayload(payload: CallSignalPayload) {
  void payload;
}

function expectRealtimeServerEvent(event: RealtimeServerEvent) {
  void event;
}

const callSummary: CallSummary = {
  call_id: "call-1",
  conversation_id: "conversation-1",
  caller: { user_id: "1001", username: "alice", display_name: "Alice" },
  callee: { user_id: "1002", username: "bob", display_name: "Bob" },
  caller_client_id: "caller-client-1",
  accepted_client_id: null,
  media_type: "video",
  state: "ringing",
  started_at: "2026-07-01T00:00:00.000Z",
  accepted_at: null,
  ended_at: null,
  end_reason: null,
};

expectMessageSendPayload({
  conversation_id: "conversation-1",
  client_msg_id: "client-message-1",
  body: "hello",
});

// @ts-expect-error message.send requires client_msg_id.
expectMessageSendPayload({
  conversation_id: "conversation-1",
  body: "hello",
});

expectDirectMessageSendPayload({
  target_username: "alice",
  client_msg_id: "client-message-2",
  body: "hello",
});

expectDirectMessageSendPayload({
  target_user_id: "1001",
  client_msg_id: "client-message-3",
  body: "hello",
});

// @ts-expect-error direct_message.send requires client_msg_id.
expectDirectMessageSendPayload({
  target_user_id: "1001",
  body: "hello",
});

// @ts-expect-error direct_message.send requires exactly one target.
expectDirectMessageSendPayload({
  client_msg_id: "client-message-4",
  body: "hello",
});

// @ts-expect-error direct_message.send rejects both target fields.
expectDirectMessageSendPayload({
  target_username: "alice",
  target_user_id: "1001",
  client_msg_id: "client-message-5",
  body: "hello",
});

expectCallInvitePayload({
  conversation_id: "conversation-1",
  media_type: "video",
});

// @ts-expect-error call.invite requires media_type.
expectCallInvitePayload({
  conversation_id: "conversation-1",
});

expectCallIdPayload({ call_id: "call-1" });

expectCallHangupPayload({
  call_id: "call-1",
  reason: "completed",
});

expectCallHangupPayload({ call_id: "call-1" });

expectCallHangupPayload({
  call_id: "call-1",
  // @ts-expect-error call.hangup reason must be a call end reason.
  reason: "not_a_reason",
});

expectCallSignalPayload({
  call_id: "call-1",
  signal_type: "offer",
  data: { type: "offer", sdp: "v=0" },
});

expectCallSignalPayload({
  call_id: "call-1",
  signal_type: "answer",
  data: { type: "answer", sdp: "v=0" },
});

expectCallSignalPayload({
  call_id: "call-1",
  signal_type: "ice_candidate",
  data: { candidate: "candidate:0" },
});

expectCallSignalPayload({
  call_id: "call-1",
  // @ts-expect-error call.signal rejects unsupported signal types.
  signal_type: "candidate",
  data: { candidate: "candidate:0" },
});

expectRealtimeServerEvent({ type: "call.incoming", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.ringing", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.accepted", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.connected", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.rejected", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.canceled", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.ended", payload: { call: callSummary } });
expectRealtimeServerEvent({ type: "call.busy", payload: { call: callSummary } });
expectRealtimeServerEvent({
  type: "call.signal",
  payload: {
    call_id: "call-1",
    signal_type: "offer",
    data: { type: "offer", sdp: "v=0" },
  },
});
