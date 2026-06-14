import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import {
  createFakeApiClient,
  createMemorySessionStore,
  makeAuthResponse,
  render,
} from "@/app/test-utils";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { DirectDraftView } from "@/features/im/components/DirectDraftView";
import { ConversationList } from "@/features/im/components/ConversationList";
import { useImStore } from "@/features/im/state/imStore";
import { AppShell } from "@/features/shell/AppShell";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, Message, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import type { RealtimeClient } from "@/shared/realtime/realtimeClient";
import type { ChatMessage } from "@/shared/utils/message";

const localUser: UserSummary = {
  user_id: "user-local",
  username: "alice",
  display_name: "Alice",
};

const directUser: UserSummary = {
  user_id: "user-bob",
  username: "bob",
  display_name: "Bob",
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    message_id: "message-1",
    conversation_id: "conversation-real",
    message_seq: 1,
    sender: localUser,
    body: "Hello Bob",
    created_at: "2026-06-14T00:00:00.000Z",
    ...overrides,
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

type RenderDirectDraftRouteOptions = {
  apiClient?: Partial<ApiClient>;
  queryClient?: QueryClient;
  sendCommand?: (type: string, payload: unknown) => Promise<unknown>;
};

async function renderDirectDraftRoute({
  apiClient: apiClientOverrides = {},
  queryClient = createQueryClient(),
  sendCommand = vi.fn().mockResolvedValue({}),
}: RenderDirectDraftRouteOptions = {}) {
  const apiClient = createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue([]),
    ...apiClientOverrides,
  });
  const realtimeClient = { sendCommand } as unknown as RealtimeClient;
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });
  const router = createMemoryRouter(
    [
      {
        path: "/app/im",
        element: (
          <RealtimeClientProvider client={realtimeClient}>
            <DirectDraftView />
          </RealtimeClientProvider>
        ),
      },
      {
        path: "/app/im/conversations/:conversationId",
        element: <div>Real conversation route</div>,
      },
    ],
    { initialEntries: ["/app/im"] },
  );
  const user = userEvent.setup();

  return {
    apiClient,
    queryClient,
    realtimeClient,
    router,
    sendCommand,
    user,
    ...render(
      <AppProviders
        apiClient={apiClient}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={createMemorySessionStore(
          makeAuthResponse({
            userId: localUser.user_id,
            username: localUser.username,
            displayName: localUser.display_name,
          }),
        )}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

async function renderDirectDraftAppShellRoute({
  apiClient: apiClientOverrides = {},
  queryClient = createQueryClient(),
  sendCommand = vi.fn().mockResolvedValue({}),
}: RenderDirectDraftRouteOptions = {}) {
  const apiClient = createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
    ...apiClientOverrides,
  });
  const realtimeClient = { sendCommand } as unknown as RealtimeClient;
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });

  function ShellUnderTest() {
    return (
      <RealtimeClientProvider client={realtimeClient}>
        <AppShell />
      </RealtimeClientProvider>
    );
  }

  const router = createMemoryRouter(
    [
      {
        path: "/app/im",
        element: <ShellUnderTest />,
      },
      {
        path: "/app/im/conversations/:conversationId",
        element: <ShellUnderTest />,
      },
    ],
    { initialEntries: ["/app/im"] },
  );
  const user = userEvent.setup();

  return {
    apiClient,
    queryClient,
    realtimeClient,
    router,
    sendCommand,
    user,
    ...render(
      <AppProviders
        apiClient={apiClient}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={createMemorySessionStore(
          makeAuthResponse({
            userId: localUser.user_id,
            username: localUser.username,
            displayName: localUser.display_name,
          }),
        )}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

async function renderConversationListRoute({
  apiClient: apiClientOverrides = {},
  queryClient = createQueryClient(),
}: {
  apiClient?: Partial<ApiClient>;
  queryClient?: QueryClient;
} = {}) {
  const apiClient = createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue([]),
    ...apiClientOverrides,
  });
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });
  const router = createMemoryRouter(
    [
      {
        path: "/app/im",
        element: <ConversationList />,
      },
    ],
    { initialEntries: ["/app/im"] },
  );
  const user = userEvent.setup();

  return {
    apiClient,
    queryClient,
    router,
    user,
    ...render(
      <AppProviders
        apiClient={apiClient}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={createMemorySessionStore(
          makeAuthResponse({
            userId: localUser.user_id,
            username: localUser.username,
            displayName: localUser.display_name,
          }),
        )}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

describe("direct draft flow", () => {
  beforeEach(() => {
    useImStore.getState().reset();
  });

  it("performs exact username lookup and creates a direct draft instead of an empty conversation", async () => {
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(directUser);
    const queryClient = createQueryClient();
    const { router, user } = await renderConversationListRoute({
      apiClient: { lookupUser },
      queryClient,
    });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New direct chat" }));
    await user.type(
      screen.getByPlaceholderText("Enter an exact username"),
      "bob",
    );
    await user.click(screen.getByRole("button", { name: "Look up user" }));

    await waitFor(() => {
      expect(lookupUser).toHaveBeenCalledWith("bob");
    });
    expect(useImStore.getState().directDraft).toMatchObject({
      target_username: "bob",
      target_user_id: "user-bob",
    });
    expect(useImStore.getState().currentConversationId).toBeNull();
    expect(useImStore.getState().mobilePanel).toBe("chat");
    expect(router.state.location.pathname).toBe("/app/im");
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      ),
    ).toEqual([]);
  });

  it("rejects a direct draft lookup for the signed-in user", async () => {
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(localUser);
    const { user } = await renderConversationListRoute({
      apiClient: { lookupUser },
    });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New direct chat" }));
    await user.type(
      screen.getByPlaceholderText("Enter an exact username"),
      "alice",
    );
    await user.click(screen.getByRole("button", { name: "Look up user" }));

    await waitFor(() => {
      expect(lookupUser).toHaveBeenCalledWith("alice");
    });
    expect(
      await screen.findByText("You cannot start a direct chat with yourself."),
    ).toBeInTheDocument();
    expect(useImStore.getState().directDraft).toBeNull();
  });

  it("sends the first direct draft message with direct_message.send and navigates to the ack conversation", async () => {
    const sendDeferred = deferred<{ conversation_id: string; message: Message }>();
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      void payload;

      if (type === "direct_message.send") {
        return sendDeferred.promise;
      }

      return Promise.resolve({});
    });
    useImStore.getState().setDirectDraft({
      target_username: "bob",
      target_user_id: "user-bob",
      target_display_name: "Bob",
    });
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.conversations(), []);
    const { router, user } = await renderDirectDraftRoute({
      queryClient,
      sendCommand,
    });

    expect(
      await screen.findByText(
        "The direct conversation appears after you send the first message.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message" });
    await user.type(composer, "Hello Bob{Enter}");

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "direct_message.send",
        expect.objectContaining({
          target_user_id: "user-bob",
          body: "Hello Bob",
          client_msg_id: expect.any(String),
        }),
      );
    });
    const payload = sendCommand.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("conversation_id");

    sendDeferred.resolve({
      conversation_id: "conversation-real",
      message: message(),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/conversation-real",
      );
    });
    expect(useImStore.getState().directDraft).toBeNull();
    expect(useImStore.getState().currentConversationId).toBe("conversation-real");
    expect(
      queryClient.getQueryData<ChatMessage[]>(
        imQueryKeys.messages("conversation-real"),
      ),
    ).toEqual([
      expect.objectContaining({
        message_id: "message-1",
        message_seq: 1,
        body: "Hello Bob",
      }),
    ]);
  });

  it("hydrates the routed chat from the direct draft ack while the conversation list API is stale", async () => {
    const listConversations = vi.fn<ApiClient["listConversations"]>().mockResolvedValue([]);
    const sendCommand = vi.fn((type: string, payload: unknown) => {
      if (type === "direct_message.send") {
        return Promise.resolve({
          conversation_id: "conversation-real",
          message: message(),
        });
      }

      if (type === "conversation.read") {
        return Promise.resolve({
          conversation_id: "conversation-real",
          read_seq: (payload as { read_seq?: number }).read_seq ?? 0,
        });
      }

      return Promise.resolve({});
    });
    useImStore.getState().setDirectDraft({
      target_username: "bob",
      target_user_id: "user-bob",
      target_display_name: "Bob",
    });
    const queryClient = createQueryClient();
    queryClient.setQueryData(imQueryKeys.conversations(), []);
    const { router, user } = await renderDirectDraftAppShellRoute({
      apiClient: { listConversations },
      queryClient,
      sendCommand,
    });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "Hello Bob{Enter}");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/conversation-real",
      );
    });
    expect(listConversations).toHaveBeenCalled();
    expect(screen.queryByText("Conversation not found")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Message list")).toHaveTextContent("Hello Bob");
    });
    expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getByText("Direct chat")).toBeInTheDocument();
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      ),
    ).toEqual([
      expect.objectContaining({
        active_member_count: 2,
        conversation_id: "conversation-real",
        direct_user: directUser,
        latest_message: expect.objectContaining({
          body: "Hello Bob",
          message_id: "message-1",
          message_seq: 1,
        }),
        latest_message_seq: 1,
        name: null,
        read_seq: 1,
        state: "active",
        type: "direct",
        unread_count: 0,
      }),
    ]);
  });

  it("shows a translated inline error when the first direct draft send fails and keeps the body retryable", async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        conversation_id: "conversation-real",
        message: message(),
      });
    useImStore.getState().setDirectDraft({
      target_username: "bob",
      target_user_id: "user-bob",
      target_display_name: "Bob",
    });
    const { router, user } = await renderDirectDraftRoute({ sendCommand });

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await user.type(composer, "Hello Bob{Enter}");

    expect(
      await screen.findByText("Could not send your first message. Try again."),
    ).toBeInTheDocument();
    expect(composer).toHaveValue("Hello Bob");

    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(2);
    });
    expect(sendCommand).toHaveBeenLastCalledWith(
      "direct_message.send",
      expect.objectContaining({ body: "Hello Bob" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/conversation-real",
      );
    });
  });
});
