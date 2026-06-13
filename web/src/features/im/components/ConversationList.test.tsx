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
  render,
} from "@/app/test-utils";
import { ConversationList } from "./ConversationList";
import { useImStore } from "@/features/im/state/imStore";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";

const localUser: UserSummary = {
  user_id: "user-local",
  username: "local",
  display_name: "Local User",
};

const directUser: UserSummary = {
  user_id: "user-alice",
  username: "alice",
  display_name: "Alice A.",
};

function conversation(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
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
    latest_message: {
      message_id: "message-1",
      message_seq: 1,
      sender: localUser,
      body: "Sprint note",
      created_at: "2026-06-14T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function renderConversationList({
  conversations,
  initialEntries = ["/app/im"],
  queryClient = createQueryClient(),
}: {
  conversations: ConversationSummary[];
  initialEntries?: string[];
  queryClient?: QueryClient;
}) {
  const apiClient = createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue(conversations),
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

  it("renders direct and group conversations with latest body, unread totals, and an active empty group", async () => {
    useImStore.getState().incrementUnreadCorrection("direct-1", 3);

    await renderConversationList({
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

  it("renders the empty state when no conversations exist", async () => {
    await renderConversationList({ conversations: [] });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    expect(
      screen.getByText("Look up a user for a direct chat or create a group."),
    ).toBeInTheDocument();
  });

  it("selects a conversation by navigating, setting current conversation, clearing local unread correction, and opening mobile chat", async () => {
    const user = userEvent.setup();
    useImStore.getState().incrementUnreadCorrection("direct-1", 3);
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

    await user.click(await screen.findByRole("button", { name: /Alice A\./ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/direct-1",
      );
    });
    expect(useImStore.getState().currentConversationId).toBe("direct-1");
    expect(useImStore.getState().mobilePanel).toBe("chat");
    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "direct-1",
    );
  });
});
