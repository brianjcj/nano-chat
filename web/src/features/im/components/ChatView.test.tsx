import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import {
  createFakeApiClient,
  createMemorySessionStore,
  makeAuthResponse,
  render,
} from "@/app/test-utils";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import { ChatView } from "./ChatView";
import type { ApiClient } from "@/shared/api/client";
import type {
  AuthResponse,
  ConversationSummary,
  Message,
  UserSummary,
} from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import type { RealtimeClient } from "@/shared/realtime/realtimeClient";
import type { ChatMessage } from "@/shared/utils/message";

const localUser: UserSummary = {
  user_id: "user-1",
  username: "alice",
  display_name: "Alice",
};

const remoteUser: UserSummary = {
  user_id: "user-2",
  username: "bob",
  display_name: "Bob",
};

function conversation(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    conversation_id: "conversation-1",
    type: "direct",
    name: null,
    state: "active",
    latest_message_seq: 0,
    read_seq: 0,
    unread_count: 0,
    active_member_count: 2,
    direct_user: remoteUser,
    latest_message: null,
    ...overrides,
  };
}

function message(
  seq: number,
  body = `Message ${seq}`,
  conversationId = "conversation-1",
): Message {
  return {
    message_id:
      conversationId === "conversation-1"
        ? `message-${seq}`
        : `message-${conversationId}-${seq}`,
    conversation_id: conversationId,
    message_seq: seq,
    sender: seq % 2 === 0 ? localUser : remoteUser,
    body,
    created_at: `2026-06-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

function latestMessageSummary(
  serverMessage: Message,
): ConversationSummary["latest_message"] {
  return {
    message_id: serverMessage.message_id,
    message_seq: serverMessage.message_seq,
    sender: serverMessage.sender,
    body: serverMessage.body,
    created_at: serverMessage.created_at,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

type RenderChatViewOptions = {
  apiClient?: Partial<ApiClient>;
  conversationId?: string;
  conversations?: ConversationSummary[];
  listMessages?: ApiClient["listMessages"];
  queryClient?: QueryClient;
  sendCommand?: (type: string, payload: unknown) => Promise<unknown>;
  session?: AuthResponse;
};

async function renderChatView({
  apiClient: apiClientOverrides = {},
  conversationId = "conversation-1",
  conversations = [conversation()],
  listMessages = vi.fn<ApiClient["listMessages"]>().mockResolvedValue([]),
  queryClient = createQueryClient(),
  sendCommand = vi.fn().mockResolvedValue({}),
  session = makeAuthResponse(),
}: RenderChatViewOptions = {}) {
  queryClient.setQueryData(imQueryKeys.conversations(), conversations);
  const apiClient = createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue(conversations),
    listMessages,
    ...apiClientOverrides,
  });
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });
  const realtimeClient = { sendCommand } as unknown as RealtimeClient;
  const user = userEvent.setup();

  return {
    apiClient,
    i18n: i18nInstance,
    listMessages,
    queryClient,
    realtimeClient,
    sendCommand,
    user,
    ...render(
      <RealtimeClientProvider client={realtimeClient}>
        <ChatView conversationId={conversationId} />
      </RealtimeClientProvider>,
      {
        wrapper({ children }) {
          return (
            <AppTestProviders
              apiClient={apiClient}
              i18nInstance={i18nInstance}
              queryClient={queryClient}
              session={session}
            >
              {children}
            </AppTestProviders>
          );
        },
      },
    ),
  };
}

function AppTestProviders({
  apiClient,
  children,
  i18nInstance,
  queryClient,
  session,
}: React.PropsWithChildren<{
  apiClient: ApiClient;
  i18nInstance: Awaited<ReturnType<typeof createAppI18n>>;
  queryClient: QueryClient;
  session: AuthResponse;
}>) {
  return (
    <AppProviders
      apiClient={apiClient}
      i18nInstance={i18nInstance}
      queryClient={queryClient}
      sessionStore={createMemorySessionStore(session)}
    >
      {children}
    </AppProviders>
  );
}

describe("ChatView", () => {
  beforeEach(() => {
    useImStore.getState().reset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("rejects empty or whitespace-only messages before sending", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const { user } = await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "   ");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Message cannot be empty")).toBeInTheDocument();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects messages over 4096 UTF-8 bytes before sending", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(composer, { target: { value: "a".repeat(4097) } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Message cannot exceed 4096 bytes"),
    ).toBeInTheDocument();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("sends with Enter and inserts a newline with Shift+Enter", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      conversation_id: "conversation-1",
      message: message(1, "hello\nworld"),
    });
    const { user } = await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.click(composer);
    await user.keyboard("hello{Shift>}{Enter}{/Shift}world");
    expect(composer).toHaveValue("hello\nworld");

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "message.send",
        expect.objectContaining({ body: "hello\nworld" }),
      );
    });
  });

  it("requests latest messages with before_seq one greater than latest_message_seq", async () => {
    const listMessages = vi.fn<ApiClient["listMessages"]>().mockResolvedValue([]);

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 7, read_seq: 7, unread_count: 0 }),
      ],
      listMessages,
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        before_seq: 8,
        limit: 50,
      });
    });
  });

  it("loads older history with before_seq equal to the current minimum message_seq", async () => {
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValueOnce([message(3), message(4)])
      .mockResolvedValueOnce([message(1), message(2)]);
    const { user } = await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 4, read_seq: 4, unread_count: 0 }),
      ],
      listMessages,
    });

    expect(await screen.findByText("Message 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load older messages" }));

    await waitFor(() => {
      expect(listMessages).toHaveBeenLastCalledWith("conversation-1", {
        before_seq: 3,
        limit: 50,
      });
    });
  });

  it("inserts a pending message, sends message.send with a client_msg_id, and replaces pending on ack", async () => {
    const sendDeferred = deferred<{ conversation_id: string; message: Message }>();
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      if (type === "message.send") {
        return sendDeferred.promise;
      }

      return Promise.resolve({
        conversation_id: "conversation-1",
        read_seq: (payload as { read_seq?: number }).read_seq ?? 0,
      });
    });
    const { queryClient, user } = await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "Hello Bob{Enter}");

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "message.send",
        expect.objectContaining({
          conversation_id: "conversation-1",
          body: "Hello Bob",
          client_msg_id: expect.any(String),
        }),
      );
    });
    const [, payload] = sendCommand.mock.calls[0];
    const clientMsgId = (payload as { client_msg_id: string }).client_msg_id;
    expect(
      queryClient.getQueryData<ChatMessage[]>(
        imQueryKeys.messages("conversation-1"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "Hello Bob",
          client_msg_id: clientMsgId,
          delivery_status: "pending",
        }),
      ]),
    );

    sendDeferred.resolve({
      conversation_id: "conversation-1",
      message: message(1, "Hello Bob"),
    });

    await waitFor(() => {
      const cachedMessages = queryClient.getQueryData<ChatMessage[]>(
        imQueryKeys.messages("conversation-1"),
      );
      expect(cachedMessages).toEqual([
        expect.objectContaining({
          message_id: "message-1",
          message_seq: 1,
          body: "Hello Bob",
        }),
      ]);
      expect(
        cachedMessages?.some(
          (candidate) => candidate.delivery_status === "pending",
        ),
      ).toBe(false);
    });
  });

  it("marks a failed pending message and exposes retry with the same client_msg_id", async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        conversation_id: "conversation-1",
        message: message(1, "Retry me"),
      })
      .mockResolvedValue({ conversation_id: "conversation-1", read_seq: 1 });
    const { user } = await renderChatView({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "Retry me{Enter}");

    expect(await screen.findByText("Send failed")).toBeInTheDocument();
    const firstPayload = sendCommand.mock.calls[0][1] as {
      client_msg_id: string;
      body: string;
    };

    await user.click(screen.getByRole("button", { name: "Retry send" }));

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([type]) => type === "message.send"),
      ).toHaveLength(2);
    });
    const messageSendCalls = sendCommand.mock.calls.filter(
      ([type]) => type === "message.send",
    );
    expect(messageSendCalls[1][1]).toMatchObject({
      body: "Retry me",
      client_msg_id: firstPayload.client_msg_id,
    });
  });

  it("resorts conversations after send ack updates the latest message", async () => {
    const olderLatest = message(2, "Older top", "conversation-older");
    const targetLatest = message(1, "Target stale", "conversation-target");
    const ackMessage = message(3, "Target fresh", "conversation-target");
    const queryClient = createQueryClient();
    const sendCommand = vi.fn((type: string) => {
      if (type === "message.send") {
        return Promise.resolve({
          conversation_id: "conversation-target",
          message: ackMessage,
        });
      }

      return Promise.resolve({ conversation_id: "conversation-target", read_seq: 0 });
    });
    const { user } = await renderChatView({
      conversationId: "conversation-target",
      conversations: [
        conversation({
          conversation_id: "conversation-older",
          latest_message_seq: olderLatest.message_seq,
          read_seq: olderLatest.message_seq,
          latest_message: latestMessageSummary(olderLatest),
        }),
        conversation({
          conversation_id: "conversation-target",
          latest_message_seq: targetLatest.message_seq,
          read_seq: targetLatest.message_seq,
          latest_message: latestMessageSummary(targetLatest),
        }),
      ],
      queryClient,
      sendCommand,
    });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "Target fresh{Enter}");

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "message.send",
        expect.objectContaining({
          conversation_id: "conversation-target",
          body: "Target fresh",
        }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ConversationSummary[]>(imQueryKeys.conversations())
          ?.map((candidate) => candidate.conversation_id),
      ).toEqual(["conversation-target", "conversation-older"]);
    });
    expect(
      queryClient.getQueryData<ConversationSummary[]>(imQueryKeys.conversations())?.[0]
        ?.latest_message,
    ).toMatchObject({
      message_id: ackMessage.message_id,
      message_seq: ackMessage.message_seq,
    });
  });

  it("marks read with highest contiguous loaded seq when visible and near the bottom", async () => {
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValue([message(1), message(2), message(3), message(5)]);
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      if (type === "conversation.read") {
        return Promise.resolve({
          conversation_id: "conversation-1",
          read_seq: (payload as { read_seq: number }).read_seq,
        });
      }

      return Promise.resolve({});
    });
    const queryClient = createQueryClient();

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 5, read_seq: 1, unread_count: 4 }),
      ],
      listMessages,
      queryClient,
      sendCommand,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("conversation.read", {
        conversation_id: "conversation-1",
        read_seq: 3,
      });
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<ConversationSummary[]>(
          imQueryKeys.conversations(),
        )?.[0],
      ).toMatchObject({ read_seq: 3, unread_count: 2 });
    });
  });

  it("marks the latest loaded contiguous window read when earlier history is unloaded", async () => {
    const loadedWindow = Array.from({ length: 50 }, (_, index) =>
      message(index + 51),
    );
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValue(loadedWindow);
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      if (type === "conversation.read") {
        return Promise.resolve({
          conversation_id: "conversation-1",
          read_seq: (payload as { read_seq: number }).read_seq,
        });
      }

      return Promise.resolve({});
    });

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 100, read_seq: 0, unread_count: 100 }),
      ],
      listMessages,
      sendCommand,
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("conversation.read", {
        conversation_id: "conversation-1",
        read_seq: 100,
      });
    });
  });

  it("retries the same read sequence after a transient conversation.read failure", async () => {
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockResolvedValue([message(1), message(2), message(3)]);
    const firstRead = deferred<{ conversation_id: string; read_seq: number }>();
    let readAttempts = 0;
    const queryClient = createQueryClient();
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      if (type === "conversation.read") {
        readAttempts += 1;

        if (readAttempts === 1) {
          return firstRead.promise;
        }

        return Promise.resolve({
          conversation_id: "conversation-1",
          read_seq: (payload as { read_seq: number }).read_seq,
        });
      }

      return Promise.resolve({});
    });

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 3, read_seq: 1, unread_count: 2 }),
      ],
      listMessages,
      queryClient,
      sendCommand,
    });

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([type]) => type === "conversation.read"),
      ).toHaveLength(1);
    });

    firstRead.reject(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();

    act(() => {
      queryClient.setQueryData(imQueryKeys.conversations(), [
        conversation({
          latest_message_seq: 3,
          read_seq: 1,
          unread_count: 2,
          active_member_count: 3,
        }),
      ]);
    });

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([type]) => type === "conversation.read"),
      ).toHaveLength(2);
    });
    expect(
      sendCommand.mock.calls.filter(([type]) => type === "conversation.read")[1]?.[1],
    ).toEqual({
      conversation_id: "conversation-1",
      read_seq: 3,
    });
  });

  it("consumes a history sync marker by fetching after_seq and merging missing messages", async () => {
    useImStore.getState().markHistorySyncNeeded("conversation-1", 1);
    const listMessages = vi
      .fn<ApiClient["listMessages"]>()
      .mockImplementation((_conversationId, query) => {
        if (query?.after_seq === 1) {
          return Promise.resolve([message(2)]);
        }

        return Promise.resolve([message(1), message(3)]);
      });
    const queryClient = createQueryClient();

    await renderChatView({
      conversations: [
        conversation({ latest_message_seq: 3, read_seq: 3, unread_count: 0 }),
      ],
      listMessages,
      queryClient,
    });

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith("conversation-1", {
        after_seq: 1,
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ChatMessage[]>(imQueryKeys.messages("conversation-1"))
          ?.map((candidate) => candidate.message_seq),
      ).toEqual([1, 2, 3]);
    });
    expect(useImStore.getState().historySyncMarkers).not.toHaveProperty(
      "conversation-1",
    );
  });
});
