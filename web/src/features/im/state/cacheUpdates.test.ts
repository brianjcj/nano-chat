import { describe, expect, it, beforeEach, vi } from "vitest";

import { createQueryClient } from "@/app/queryClient";
import { imQueryKeys } from "../api/imQueries";
import { applyRealtimeEvent } from "./cacheUpdates";
import { useImStore } from "./imStore";
import type { ConversationSummary, Message, UserSummary } from "@/shared/api/types";

const sender: UserSummary = {
  user_id: "1001",
  username: "alice",
  display_name: "Alice",
};

function makeMessage(
  message_seq: number,
  conversation_id = "conversation-1",
  messageSender = sender,
): Message {
  return {
    message_id: `message-${conversation_id}-${message_seq}`,
    conversation_id,
    message_seq,
    sender: messageSender,
    body: `message ${message_seq}`,
    message_type: "text",
    metadata: {},
    created_at: `2026-06-13T00:00:0${message_seq}.000Z`,
  };
}

function latestMessage(message: Message): ConversationSummary["latest_message"] {
  return {
    message_id: message.message_id,
    message_seq: message.message_seq,
    sender: message.sender,
    body: message.body,
    message_type: message.message_type,
    metadata: message.metadata,
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

function readUpdated(
  conversation_id: string,
  user_id: string,
  read_seq: number,
) {
  return {
    type: "conversation.read_updated",
    payload: {
      conversation_id,
      user_id,
      read_seq,
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
    const incomingMessage: Message = {
      ...makeMessage(2),
      message_type: "call_event",
      metadata: {
        call_id: "018f0000-0000-7000-8000-000000000040",
        media_type: "video",
        outcome: "completed",
      },
    };
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
        message_type: "call_event",
        metadata: incomingMessage.metadata,
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

  it("resorts conversations after a realtime latest-message update while keeping empty groups stable", () => {
    const queryClient = createQueryClient();
    const olderMessage = makeMessage(2, "conversation-older");
    const staleMessage = makeMessage(1, "conversation-target");
    const incomingMessage = makeMessage(3, "conversation-target");
    queryClient.setQueryData(imQueryKeys.conversations(), [
      makeConversation("conversation-older", olderMessage),
      makeConversation("empty-group-a", makeMessage(0, "empty-group-a")),
      makeConversation("conversation-target", staleMessage),
      makeConversation("empty-group-b", makeMessage(0, "empty-group-b")),
    ]);
    queryClient.setQueryData<ConversationSummary[]>(
      imQueryKeys.conversations(),
      (conversations) =>
        conversations?.map((conversation) =>
          conversation.conversation_id.startsWith("empty-group")
            ? {
                ...conversation,
                latest_message_seq: 0,
                latest_message: null,
              }
            : conversation,
        ),
    );

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(incomingMessage),
    });

    const conversations = queryClient.getQueryData<ConversationSummary[]>(
      imQueryKeys.conversations(),
    );
    expect(
      conversations?.map((conversation) => conversation.conversation_id),
    ).toEqual([
      "conversation-target",
      "conversation-older",
      "empty-group-a",
      "empty-group-b",
    ]);
    expect(conversations?.[0]?.latest_message).toMatchObject({
      message_id: incomingMessage.message_id,
      message_seq: 3,
    });
  });

  it("does not create a message cache for message.created when the conversation messages are not loaded", () => {
    const queryClient = createQueryClient();
    const message = makeMessage(1, "conversation-2");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(message),
    });

    expect(
      queryClient.getQueryState(imQueryKeys.messages("conversation-2")),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData<Message[]>(imQueryKeys.messages("conversation-2")),
    ).toBeUndefined();
  });

  it("seeds an incoming direct conversation when message.created is absent from the conversation list", () => {
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const incomingMessage = makeMessage(1, "direct-new");
    queryClient.setQueryData(imQueryKeys.conversations(), []);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      currentUserId: "1000",
      event: messageCreated(incomingMessage),
    });

    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      ),
    ).toEqual([
      expect.objectContaining({
        active_member_count: 2,
        conversation_id: "direct-new",
        direct_user: sender,
        latest_message: expect.objectContaining({
          body: "message 1",
          message_id: incomingMessage.message_id,
          message_seq: 1,
          message_type: incomingMessage.message_type,
          metadata: incomingMessage.metadata,
        }),
        latest_message_seq: 1,
        name: null,
        read_seq: 0,
        state: "active",
        type: "direct",
        unread_count: 1,
      }),
    ]);
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "direct-new",
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: imQueryKeys.conversations(),
    });
  });

  it("does not insert message.created into query-specific history page caches", () => {
    const queryClient = createQueryClient();
    const historyPageKey = imQueryKeys.messages("conversation-1", {
      before_seq: 10,
      limit: 2,
    });
    queryClient.setQueryData(historyPageKey, [makeMessage(5), makeMessage(6)]);

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(11)),
    });

    expect(
      queryClient
        .getQueryData<Message[]>(historyPageKey)
        ?.map((message) => message.message_seq),
    ).toEqual([5, 6]);
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

  it("does not increment unread correction for a non-current duplicate message.created", () => {
    const queryClient = createQueryClient();
    const knownMessage = makeMessage(1, "conversation-2");
    queryClient.setQueryData(imQueryKeys.messages("conversation-2"), [
      knownMessage,
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(knownMessage),
    });

    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "conversation-2",
    );
  });

  it("does not increment unread correction twice when duplicate message.created is already reflected in the conversations cache", () => {
    const queryClient = createQueryClient();
    const existingLatest = makeMessage(1, "conversation-2");
    const incomingMessage = makeMessage(2, "conversation-2");
    queryClient.setQueryData(imQueryKeys.conversations(), [
      makeConversation("conversation-2", existingLatest),
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

    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "conversation-2": 1,
    });
  });

  it("does not increment unread correction for the current user's message.created in a non-current conversation", () => {
    const queryClient = createQueryClient();
    const localSender: UserSummary = {
      user_id: "1000",
      username: "local",
      display_name: "Local User",
    };
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      currentUserId: "1000",
      event: messageCreated(makeMessage(1, "conversation-2", localSender)),
    });

    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "conversation-2",
    );
  });

  it("marks history backfill needed with before_seq when message.created reveals a sequence gap in the current conversation", () => {
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

    expect(useImStore.getState().historyBackfillMarkers).toMatchObject({
      "conversation-1": { before_seq: 3 },
    });
  });

  it("does not mark history backfill when realtime extends a loaded recent window", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(51),
      makeMessage(52),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(53)),
    });

    expect(useImStore.getState().historyBackfillMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("marks history backfill from the incoming seq when the loaded window already has a gap", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.messages("conversation-1"), [
      makeMessage(1),
      makeMessage(3),
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      event: messageCreated(makeMessage(4)),
    });

    expect(useImStore.getState().historyBackfillMarkers).toMatchObject({
      "conversation-1": { before_seq: 4 },
    });
  });

  it("updates local read state when conversation.read_updated belongs to the current user", () => {
    const queryClient = createQueryClient();
    const latest = makeMessage(5);
    queryClient.setQueryData(imQueryKeys.conversations(), [
      {
        ...makeConversation("conversation-1", latest),
        read_seq: 2,
        unread_count: 3,
      },
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");
    useImStore.getState().incrementUnreadCorrection("conversation-1", 2);

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      currentUserId: "1001",
      event: readUpdated("conversation-1", "1001", 4),
    });

    const conversations = queryClient.getQueryData<ConversationSummary[]>(
      imQueryKeys.conversations(),
    );
    expect(conversations?.[0]).toMatchObject({
      read_seq: 4,
      unread_count: 1,
    });
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("clears unread correction for the current user's conversation.read_updated even when the conversation is not open", () => {
    const queryClient = createQueryClient();
    const latest = makeMessage(5);
    queryClient.setQueryData(imQueryKeys.conversations(), [
      {
        ...makeConversation("conversation-1", latest),
        read_seq: 2,
        unread_count: 3,
      },
    ]);
    useImStore.getState().setCurrentConversationId("conversation-2");
    useImStore.getState().incrementUnreadCorrection("conversation-1", 2);

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      currentUserId: "1001",
      event: readUpdated("conversation-1", "1001", 4),
    });

    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "conversation-1",
    );
  });

  it("ignores another user's conversation.read_updated for local read state", () => {
    const queryClient = createQueryClient();
    const latest = makeMessage(5);
    queryClient.setQueryData(imQueryKeys.conversations(), [
      {
        ...makeConversation("conversation-1", latest),
        read_seq: 2,
        unread_count: 3,
      },
    ]);
    useImStore.getState().setCurrentConversationId("conversation-1");
    useImStore.getState().incrementUnreadCorrection("conversation-1", 2);

    applyRealtimeEvent({
      queryClient,
      store: useImStore,
      currentUserId: "1001",
      event: readUpdated("conversation-1", "1002", 5),
    });

    const conversations = queryClient.getQueryData<ConversationSummary[]>(
      imQueryKeys.conversations(),
    );
    expect(conversations?.[0]).toMatchObject({
      read_seq: 2,
      unread_count: 3,
    });
    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "conversation-1": 2,
    });
  });
});
