import type {
  DirectMessageSendPayload,
  MessageSendPayload,
} from "./protocol";

function expectMessageSendPayload(payload: MessageSendPayload) {
  void payload;
}

function expectDirectMessageSendPayload(payload: DirectMessageSendPayload) {
  void payload;
}

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
  target_user_id: "user-1",
  client_msg_id: "client-message-3",
  body: "hello",
});

// @ts-expect-error direct_message.send requires client_msg_id.
expectDirectMessageSendPayload({
  target_user_id: "user-1",
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
  target_user_id: "user-1",
  client_msg_id: "client-message-5",
  body: "hello",
});
