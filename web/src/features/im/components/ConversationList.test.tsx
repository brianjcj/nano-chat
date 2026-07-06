import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import {
  createFakeApiClient,
  createMemorySessionStore,
  render,
} from "@/app/test-utils";
import { ConversationList } from "./ConversationList";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { applyRealtimeEvent } from "@/features/im/state/cacheUpdates";
import { useImStore } from "@/features/im/state/imStore";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, Message, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";

const localUser: UserSummary = {
  user_id: "1000",
  username: "local",
  display_name: "Local User",
};

const directUser: UserSummary = {
  user_id: "1002",
  username: "alice",
  display_name: "Alice A.",
};

type LatestMessage = NonNullable<ConversationSummary["latest_message"]>;
type ConversationOverrides = Partial<Omit<ConversationSummary, "latest_message">> & {
  latest_message?: Partial<LatestMessage> | null;
};

function conversation(overrides: ConversationOverrides = {}): ConversationSummary {
  const { latest_message: latestMessageOverride, ...conversationOverrides } =
    overrides;
  const latestMessage: LatestMessage = {
    message_id: "message-1",
    message_seq: 1,
    sender: localUser,
    body: "Sprint note",
    message_type: "text",
    metadata: {},
    created_at: "2026-06-14T00:00:00.000Z",
    ...(latestMessageOverride ?? {}),
  };

  return {
    conversation_id: "conversation-1",
    type: "group",
    name: "Design Guild",
    state: "active",
    latest_message_seq: 1,
    read_seq: 0,
    unread_count: 0,
    active_member_count: 2,
    direct_user: null,
    latest_message: latestMessageOverride === null ? null : latestMessage,
    ...conversationOverrides,
  };
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function renderConversationList({
  conversations = [],
  initialEntries = ["/app/im"],
  listConversations,
  queryClient = createQueryClient(),
}: {
  conversations?: ConversationSummary[];
  initialEntries?: string[];
  listConversations?: ApiClient["listConversations"];
  queryClient?: QueryClient;
}) {
  const apiClient = createFakeApiClient({
    listConversations:
      listConversations ?? vi.fn().mockResolvedValue(conversations),
  } satisfies Partial<ApiClient>);
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
      {
        path: "/app/im/conversations/:conversationId",
        element: <ConversationList />,
      },
    ],
    { initialEntries },
  );

  return {
    apiClient,
    router,
    ...render(
      <AppProviders
        apiClient={apiClient}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={createMemorySessionStore()}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

describe("ConversationList", () => {
  beforeEach(() => {
    useImStore.getState().reset();
  });

  it("does not render decorative conversation list header copy", async () => {
    await renderConversationList({ conversations: [] });

    expect(screen.queryByText("Chat")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Your lightweight realtime chat entrance"),
    ).not.toBeInTheDocument();
  });

  it("renders direct and group conversations with latest body, unread totals, and an active empty group", async () => {
    await renderConversationList({
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 5,
          direct_user: directUser,
          latest_message: {
            message_id: "message-direct-1",
            message_seq: 8,
            sender: directUser,
            body: "Hey from Alice",
            created_at: "2026-06-14T00:01:00.000Z",
          },
        }),
        conversation({
          conversation_id: "group-1",
          type: "group",
          name: "Design Guild",
          latest_message: {
            message_id: "message-group-1",
            message_seq: 3,
            sender: localUser,
            body: "Sprint note",
            created_at: "2026-06-14T00:02:00.000Z",
          },
        }),
        conversation({
          conversation_id: "empty-group-1",
          type: "group",
          name: "Quiet Launch",
          latest_message_seq: 0,
          read_seq: 0,
          latest_message: null,
          active_member_count: 4,
        }),
      ],
    });

    expect(await screen.findByText("Alice A.")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Hey from Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("5 unread")).toHaveTextContent("5");
    expect(screen.getByText("Design Guild")).toBeInTheDocument();
    expect(screen.getByText("Sprint note")).toBeInTheDocument();
    expect(screen.getByText("Quiet Launch")).toBeInTheDocument();
    expect(screen.getByText("Active group · no messages yet")).toBeInTheDocument();
  });

  it("renders conversations as dense client rows instead of floating cards", async () => {
    await renderConversationList({
      initialEntries: ["/app/im/conversations/direct-1"],
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 2,
          direct_user: directUser,
          latest_message: {
            message_id: "message-direct-1",
            message_seq: 8,
            sender: directUser,
            body: "Hey from Alice",
            created_at: "2026-06-14T00:01:00.000Z",
          },
        }),
      ],
    });

    const row = (await screen.findByText("Alice A.")).closest("button");

    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).toHaveClass("rounded-none", "border-b", "shadow-none");
    expect(row).not.toHaveClass("hover:-translate-y-0.5");
  });

  it("hides the direct username subtitle when it duplicates the conversation title", async () => {
    await renderConversationList({
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          direct_user: {
            user_id: "1002",
            username: "jcj",
            display_name: "jcj",
          },
        }),
      ],
    });

    expect(await screen.findByText("jcj")).toBeInTheDocument();
    expect(screen.queryByText("@jcj")).not.toBeInTheDocument();
  });

  it("renders latest-message time and omits it for conversations without messages", async () => {
    await renderConversationList({
      conversations: [
        conversation({
          conversation_id: "archive-group-1",
          type: "group",
          name: "Archive Guild",
          latest_message: {
            message_id: "message-archive-1",
            message_seq: 2,
            sender: localUser,
            body: "Archived note",
            created_at: "1999-12-31T09:00:00",
          },
        }),
        conversation({
          conversation_id: "empty-group-1",
          type: "group",
          name: "Quiet Launch",
          latest_message_seq: 0,
          read_seq: 0,
          latest_message: null,
          active_member_count: 4,
        }),
      ],
    });

    expect(await screen.findByText("Archive Guild")).toBeInTheDocument();
    expect(screen.getByText("99/12/31")).toBeInTheDocument();
    expect(screen.getByText("Quiet Launch")).toBeInTheDocument();
    expect(screen.getAllByText(/\d{2}\/\d{2}\/\d{2}/)).toHaveLength(1);
  });

  it("renders the empty state when no conversations exist", async () => {
    await renderConversationList({ conversations: [] });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    expect(
      screen.getByText("Look up a user for a direct chat or create a group."),
    ).toBeInTheDocument();
  });

  it("keeps realtime unread correction and latest message when a stale conversation fetch resolves after realtime", async () => {
    const queryClient = createQueryClient();
    const staleConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 1,
      unread_count: 0,
      direct_user: directUser,
      latest_message: {
        message_id: "message-rest-1",
        message_seq: 1,
        sender: localUser,
        body: "Cached REST message",
        created_at: "2026-06-14T00:01:00.000Z",
      },
    });
    const realtimeMessage: Message = {
      message_id: "message-realtime-1",
      conversation_id: "direct-1",
      message_seq: 2,
      sender: directUser,
      body: "Realtime ping",
      message_type: "text",
      metadata: {},
      created_at: "2026-06-14T00:03:00.000Z",
    };
    const staleFetch = deferred<ConversationSummary[]>();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockReturnValue(staleFetch.promise);

    queryClient.setQueryData(imQueryKeys.conversations(), [staleConversation]);
    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();
    expect(screen.getByText("Cached REST message")).toBeInTheDocument();

    const refetchPromise = queryClient.refetchQueries({
      queryKey: imQueryKeys.conversations(),
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useImStore.getState().setCurrentConversationId("current-conversation");
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: "1001",
        event: {
          type: "message.created",
          payload: {
            conversation_id: "direct-1",
            message: realtimeMessage,
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Realtime ping")).toBeInTheDocument();
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });

    await act(async () => {
      staleFetch.resolve([staleConversation]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(screen.getByText("Realtime ping")).toBeInTheDocument();
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "direct-1": 1,
    });
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      )?.[0],
    ).toMatchObject({
      latest_message_seq: 2,
      latest_message: {
        message_id: "message-realtime-1",
        body: "Realtime ping",
      },
    });
  });

  it("keeps a realtime-updated conversation above older threads when a stale refetch resolves", async () => {
    const queryClient = createQueryClient();
    const olderConversation = conversation({
      conversation_id: "group-older",
      type: "group",
      name: "Roadmap",
      latest_message_seq: 3,
      read_seq: 3,
      unread_count: 0,
      latest_message: {
        message_id: "message-older-3",
        message_seq: 3,
        sender: localUser,
        body: "Older thread",
        created_at: "2026-06-14T00:03:00.000Z",
      },
    });
    const staleRealtimeConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 1,
      read_seq: 1,
      unread_count: 0,
      direct_user: directUser,
      latest_message: {
        message_id: "message-stale-1",
        message_seq: 1,
        sender: localUser,
        body: "Stale REST message",
        created_at: "2026-06-14T00:01:00.000Z",
      },
    });
    const emptyGroupA = conversation({
      conversation_id: "empty-group-a",
      type: "group",
      name: "Quiet Launch",
      latest_message_seq: 0,
      read_seq: 0,
      unread_count: 0,
      latest_message: null,
      active_member_count: 4,
    });
    const emptyGroupB = conversation({
      conversation_id: "empty-group-b",
      type: "group",
      name: "Silent Ops",
      latest_message_seq: 0,
      read_seq: 0,
      unread_count: 0,
      latest_message: null,
      active_member_count: 3,
    });
    const realtimeMessage: Message = {
      message_id: "message-realtime-4",
      conversation_id: "direct-1",
      message_seq: 4,
      sender: directUser,
      body: "Realtime top message",
      message_type: "text",
      metadata: {},
      created_at: "2026-06-14T00:04:00.000Z",
    };
    const staleFetch = deferred<ConversationSummary[]>();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockReturnValue(staleFetch.promise);

    queryClient.setQueryData(imQueryKeys.conversations(), [
      olderConversation,
      emptyGroupA,
      staleRealtimeConversation,
      emptyGroupB,
    ]);
    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    const refetchPromise = queryClient.refetchQueries({
      queryKey: imQueryKeys.conversations(),
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useImStore.getState().setCurrentConversationId("current-conversation");
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: "1001",
        event: {
          type: "message.created",
          payload: {
            conversation_id: "direct-1",
            message: realtimeMessage,
          },
        },
      });
    });

    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ConversationSummary[]>(imQueryKeys.conversations())
          ?.map((candidate) => candidate.conversation_id),
      ).toEqual([
        "direct-1",
        "group-older",
        "empty-group-a",
        "empty-group-b",
      ]);
    });

    await act(async () => {
      staleFetch.resolve([
        olderConversation,
        emptyGroupA,
        staleRealtimeConversation,
        emptyGroupB,
      ]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ConversationSummary[]>(imQueryKeys.conversations())
          ?.map((candidate) => candidate.conversation_id),
      ).toEqual([
        "direct-1",
        "group-older",
        "empty-group-a",
        "empty-group-b",
      ]);
    });
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      )?.[0],
    ).toMatchObject({
      conversation_id: "direct-1",
      latest_message_seq: 4,
      latest_message: {
        message_id: "message-realtime-4",
        body: "Realtime top message",
      },
    });
  });

  it("keeps a locally advanced read_seq and unread_count when a stale refetch resolves", async () => {
    const queryClient = createQueryClient();
    const staleUnreadConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 5,
      read_seq: 2,
      unread_count: 3,
      direct_user: directUser,
      latest_message: {
        message_id: "message-latest-5",
        message_seq: 5,
        sender: directUser,
        body: "Needs reading",
        created_at: "2026-06-14T00:05:00.000Z",
      },
    });
    const staleFetch = deferred<ConversationSummary[]>();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockReturnValue(staleFetch.promise);

    queryClient.setQueryData(imQueryKeys.conversations(), [
      staleUnreadConversation,
    ]);
    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    const refetchPromise = queryClient.refetchQueries({
      queryKey: imQueryKeys.conversations(),
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(1);
    });

    act(() => {
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: "1001",
        event: {
          type: "conversation.read_updated",
          payload: {
            conversation_id: "direct-1",
            user_id: "1001",
            read_seq: 5,
          },
        },
      });
    });

    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      )?.[0],
    ).toMatchObject({
      read_seq: 5,
      unread_count: 0,
    });

    await act(async () => {
      staleFetch.resolve([staleUnreadConversation]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ConversationSummary[]>(
          imQueryKeys.conversations(),
        )?.[0],
      ).toMatchObject({
        read_seq: 5,
        unread_count: 0,
      });
    });
  });

  it("recomputes unread_count when fetched latest fields meet a locally advanced read_seq", async () => {
    const queryClient = createQueryClient();
    const currentConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 5,
      read_seq: 5,
      unread_count: 0,
      direct_user: directUser,
      latest_message: {
        message_id: "message-current-5",
        message_seq: 5,
        sender: directUser,
        body: "Already read cached message",
        created_at: "2026-06-14T00:05:00.000Z",
      },
    });
    const fetchedConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 6,
      read_seq: 4,
      unread_count: 2,
      direct_user: directUser,
      latest_message: {
        message_id: "message-fetched-6",
        message_seq: 6,
        sender: directUser,
        body: "Backend has a newer message",
        created_at: "2026-06-14T00:06:00.000Z",
      },
    });
    const fetchedLatest = deferred<ConversationSummary[]>();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockReturnValue(fetchedLatest.promise);

    queryClient.setQueryData(imQueryKeys.conversations(), [
      currentConversation,
    ]);
    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    const refetchPromise = queryClient.refetchQueries({
      queryKey: imQueryKeys.conversations(),
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fetchedLatest.resolve([fetchedConversation]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(screen.getByText("Backend has a newer message")).toBeInTheDocument();
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      )?.[0],
    ).toMatchObject({
      latest_message_seq: 6,
      read_seq: 5,
      unread_count: 1,
      latest_message: {
        message_id: "message-fetched-6",
        body: "Backend has a newer message",
      },
    });
  });

  it("clears realtime unread correction when a later conversation fetch covers the realtime sequence", async () => {
    const queryClient = createQueryClient();
    const initialConversation = conversation({
      conversation_id: "direct-1",
      type: "direct",
      name: null,
      latest_message_seq: 1,
      unread_count: 0,
      direct_user: directUser,
      latest_message: {
        message_id: "message-rest-1",
        message_seq: 1,
        sender: localUser,
        body: "Cached REST message",
        created_at: "2026-06-14T00:01:00.000Z",
      },
    });
    const realtimeMessage: Message = {
      message_id: "message-realtime-1",
      conversation_id: "direct-1",
      message_seq: 2,
      sender: directUser,
      body: "Realtime ping",
      message_type: "text",
      metadata: {},
      created_at: "2026-06-14T00:03:00.000Z",
    };
    const authoritativeFetch = deferred<ConversationSummary[]>();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockReturnValue(authoritativeFetch.promise);

    queryClient.setQueryData(imQueryKeys.conversations(), [initialConversation]);
    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    const refetchPromise = queryClient.refetchQueries({
      queryKey: imQueryKeys.conversations(),
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useImStore.getState().setCurrentConversationId("current-conversation");
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: "1001",
        event: {
          type: "message.created",
          payload: {
            conversation_id: "direct-1",
            message: realtimeMessage,
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Realtime ping")).toBeInTheDocument();
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "direct-1": 1,
    });

    await act(async () => {
      authoritativeFetch.resolve([
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          latest_message_seq: 2,
          unread_count: 1,
          direct_user: directUser,
          latest_message: {
            message_id: realtimeMessage.message_id,
            message_seq: realtimeMessage.message_seq,
            sender: realtimeMessage.sender,
            body: realtimeMessage.body,
            created_at: realtimeMessage.created_at,
          },
        }),
      ]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "direct-1",
    );
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        imQueryKeys.conversations(),
      )?.[0],
    ).toMatchObject({
      latest_message_seq: 2,
      latest_message: {
        message_id: "message-realtime-1",
        body: "Realtime ping",
      },
    });
  });

  it("preserves realtime unread corrections until a conversation refetch returns authoritative unread", async () => {
    const queryClient = createQueryClient();
    const realtimeMessage: Message = {
      message_id: "message-realtime-1",
      conversation_id: "direct-1",
      message_seq: 2,
      sender: directUser,
      body: "Realtime ping",
      message_type: "text",
      metadata: {},
      created_at: "2026-06-14T00:03:00.000Z",
    };
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockResolvedValueOnce([
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          latest_message_seq: 1,
          unread_count: 0,
          direct_user: directUser,
        }),
      ])
      .mockResolvedValueOnce([
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          latest_message_seq: 2,
          unread_count: 1,
          direct_user: directUser,
          latest_message: {
            message_id: realtimeMessage.message_id,
            message_seq: realtimeMessage.message_seq,
            sender: realtimeMessage.sender,
            body: realtimeMessage.body,
            created_at: realtimeMessage.created_at,
          },
        }),
      ]);

    await renderConversationList({ listConversations, queryClient });
    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    act(() => {
      useImStore.getState().setCurrentConversationId("current-conversation");
      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId: "1001",
        event: {
          type: "message.created",
          payload: {
            conversation_id: "direct-1",
            message: realtimeMessage,
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "direct-1": 1,
    });

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: imQueryKeys.conversations(),
      });
    });

    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    });
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "direct-1",
    );
  });

  it("clears local unread corrections when fresh conversation query data arrives", async () => {
    const queryClient = createQueryClient();
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockResolvedValueOnce([
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 2,
          direct_user: directUser,
        }),
      ])
      .mockResolvedValueOnce([
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 4,
          direct_user: directUser,
        }),
      ]);

    await renderConversationList({ listConversations, queryClient });

    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    act(() => {
      useImStore.getState().incrementUnreadCorrection("direct-1", 3);
    });
    expect(await screen.findByLabelText("5 unread")).toHaveTextContent("5");

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: imQueryKeys.conversations(),
      });
    });

    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText("4 unread")).toHaveTextContent("4");
    });
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "direct-1",
    );
  });

  it("selects a conversation by navigating, setting current conversation, preserving local unread correction, and opening mobile chat", async () => {
    const user = userEvent.setup();
    const { router } = await renderConversationList({
      conversations: [
        conversation({
          conversation_id: "direct-1",
          type: "direct",
          name: null,
          unread_count: 2,
          direct_user: directUser,
        }),
      ],
    });

    expect(await screen.findByText("Alice A.")).toBeInTheDocument();

    act(() => {
      useImStore.getState().incrementUnreadCorrection("direct-1", 3);
    });
    expect(await screen.findByLabelText("5 unread")).toHaveTextContent("5");

    await user.click(await screen.findByRole("button", { name: /Alice A\./ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/direct-1",
      );
    });
    expect(useImStore.getState().currentConversationId).toBe("direct-1");
    expect(useImStore.getState().mobilePanel).toBe("chat");
    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "direct-1": 3,
    });
  });
});
