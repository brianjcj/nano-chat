import { describe, expect, it, beforeEach } from "vitest";

import { createQueryClient } from "@/app/queryClient";
import { imQueryKeys } from "../api/imQueries";
import { applyRealtimeEvent } from "./cacheUpdates";
import { useImStore } from "./imStore";
import type { ConversationSummary, Message, UserSummary } from "@/shared/api/types";

const sender: UserSummary = {
  user_id: "user-1",
  username: "alice",
  display_name: "Alice",
};

function makeMessage(message_seq: number, conversation_id = "conversation-1"): Message {
  return {
    message_id: `message-${conversation_id}-${message_seq}`,
    conversation_id,
    message_seq,
    sender,
    body: `message ${message_seq}`,
    created_at: `2026-06-13T00:00:0${message_seq}.000Z`,
  };
}

function latestMessage(message: Message): ConversationSummary["latest_message"] {
  return {
    message_id: message.message_id,
    message_seq: message.message_seq,
    sender: message.sender,
    body: message.body,
    created_at: message.created_at,
  };
}

function makeConversation(
  conversation_id = "conversation-1",
  latest = makeMessage(1, conversation_id),
): ConversationSummary {
  return {
    conversation_id,
    type: "group",
    name: "project",
    state: "active",
    latest_message_seq: latest.message_seq,
    read_seq: latest.message_seq,
    unread_count: 0,
    active_member_count: 2,
    direct_user: null,
    latest_message: latestMessage(latest),
  };
}

function messageCreated(message: Message) {
  return {
    type: "message.created",
    payload: {
      conversation_id: message.conversation_id,
      message,
    },
  } as const;
}

describe("IM realtime cache updates", () => {
  beforeEach(() => {
    useImStore.getState().reset();
  });

  it("updates the matching conversation latest message and inserts message.created into cache without duplicates", () => {
    const queryClient = createQueryClient();
    const existingMessage = makeMessage(1);
    const incomingMessage = makeMessage(2);
    queryClient.setQueryData(imQueryKeys.conversations(), [
      makeConversation("conversation-1", existingMessage),
    ]);
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      existingMessage,
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(incomingMessage),
    });
    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(incomingMessage),
    });

    const conversations = queryClient.getQueryData<ConversationSummary[]>(
      imQueryKeys.conversations(),
    );
    expect(conversations?.[0]).toMatchObject({
      conversation_id: "conversation-1",
      latest_message_seq: 2,
      latest_message: {
        message_id: incomingMessage.message_id,
        message_seq: 2,
        body: "message 2",
      },
    });

    const messages = queryClient.getQueryData<Message[]>(
      imQueryKeys.messages("conversation-1"),
    );
    expect(messages?.map((message) => message.message_seq)).toEqual([1, 2]);
    expect(
      messages?.filter(
        (message) => message.message_id === incomingMessage.message_id,
      ),
    ).toHaveLength(1);
  });

  it("increments local unread count for message.created in a non-current conversation", () => {
    const queryClient = createQueryClient();
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(1, "conversation-2")),
    });

    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "conversation-2": 1,
    });
  });

  it("marks history sync needed when message.created reveals a sequence gap in the current conversation", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(1),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(3)),
    });

    expect(useImStore.getState().historySyncMarkers).toMatchObject({
      "conversation-1": { after_seq: 1 },
    });
  });
});
