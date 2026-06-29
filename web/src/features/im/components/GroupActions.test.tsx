import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import {
  createFakeApiClient,
  createMemorySessionStore,
  makeAuthResponse,
  render,
} from "@/app/test-utils";
import { AppShell } from "@/features/shell/AppShell";
import { useImStore } from "@/features/im/state/imStore";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import type { RealtimeClient } from "@/shared/realtime/realtimeClient";

const localUser: UserSummary = {
  user_id: "1001",
  username: "alice",
  display_name: "Alice",
};

const bob: UserSummary = {
  user_id: "1002",
  username: "bob",
  display_name: "Bob",
};

const charlie: UserSummary = {
  user_id: "1003",
  username: "charlie",
  display_name: "Charlie",
};

function group(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    conversation_id: "group-1",
    type: "group",
    name: "Design Guild",
    state: "active",
    latest_message_seq: 0,
    read_seq: 0,
    unread_count: 0,
    active_member_count: 2,
    direct_user: null,
    latest_message: null,
    ...overrides,
  };
}

type RenderImShellOptions = {
  apiClient?: Partial<ApiClient>;
  conversations?: ConversationSummary[];
  initialEntries?: string[];
  listConversations?: ApiClient["listConversations"];
  queryClient?: QueryClient;
  sendCommand?: (type: string, payload: unknown) => Promise<unknown>;
};

async function renderImShell({
  apiClient: apiClientOverrides = {},
  conversations = [],
  initialEntries = ["/app/im"],
  listConversations,
  queryClient = createQueryClient(),
  sendCommand = vi.fn().mockResolvedValue({}),
}: RenderImShellOptions = {}) {
  const resolvedListConversations =
    listConversations ?? vi.fn<ApiClient["listConversations"]>().mockResolvedValue(conversations);
  const apiClient = createFakeApiClient({
    listConversations: resolvedListConversations,
    listMessages: vi.fn<ApiClient["listMessages"]>().mockResolvedValue([]),
    listMembers: vi.fn<ApiClient["listMembers"]>().mockResolvedValue([]),
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
            <AppShell />
          </RealtimeClientProvider>
        ),
      },
      {
        path: "/app/im/conversations/:conversationId",
        element: (
          <RealtimeClientProvider client={realtimeClient}>
            <AppShell />
          </RealtimeClientProvider>
        ),
      },
    ],
    { initialEntries },
  );
  const user = userEvent.setup();

  return {
    apiClient,
    listConversations: resolvedListConversations,
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

async function openCreateGroupDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Create group" }));

  return screen.findByRole("dialog", { name: "Create group" });
}

async function openMemberPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Group members" }));

  return screen.findByRole("dialog", { name: "Group members" });
}

describe("group creation and member actions", () => {
  beforeEach(() => {
    useImStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a non-empty group name and at least one other member before submitting", async () => {
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(bob);
    const { user } = await renderImShell({
      apiClient: { lookupUser },
      conversations: [],
    });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();

    const dialog = await openCreateGroupDialog(user);
    const submit = within(dialog).getByRole("button", { name: "Create group" });

    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Group name"), "Launch Room");
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText("Group name"));
    await user.type(within(dialog).getByLabelText("Member username"), "bob");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));

    await waitFor(() => {
      expect(lookupUser).toHaveBeenCalledWith("bob");
    });
    expect(await within(dialog).findByText("Bob")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Group name"), "Launch Room");
    expect(submit).toBeEnabled();
  });

  it("uses exact username lookup to add group members", async () => {
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(bob);
    const { user } = await renderImShell({
      apiClient: { lookupUser },
      conversations: [],
    });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();

    const dialog = await openCreateGroupDialog(user);
    await user.type(within(dialog).getByLabelText("Member username"), "bob");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));

    await waitFor(() => {
      expect(lookupUser).toHaveBeenCalledWith("bob");
    });
    expect(await within(dialog).findByText("Bob")).toBeInTheDocument();
    expect(within(dialog).getByText("@bob")).toBeInTheDocument();
  });

  it("navigates to the created group conversation and invalidates the conversation list", async () => {
    const createdGroup = group({
      conversation_id: "group-new",
      name: "Launch Room",
      active_member_count: 2,
    });
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdGroup]);
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(bob);
    const createGroup = vi
      .fn<ApiClient["createGroup"]>()
      .mockResolvedValue(createdGroup);
    const { router, user } = await renderImShell({
      apiClient: { createGroup, lookupUser },
      listConversations,
    });

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();

    const dialog = await openCreateGroupDialog(user);
    await user.type(within(dialog).getByLabelText("Group name"), "Launch Room");
    await user.type(within(dialog).getByLabelText("Member username"), "bob");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));
    expect(await within(dialog).findByText("Bob")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));

    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith({
        name: "Launch Room",
        member_ids: ["1002"],
      });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/group-new",
      );
    });
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(2);
    });
  });

  it("lists active group members in the member panel", async () => {
    const listMembers = vi
      .fn<ApiClient["listMembers"]>()
      .mockResolvedValue([localUser, bob]);
    const { user } = await renderImShell({
      apiClient: { listMembers },
      conversations: [group()],
      initialEntries: ["/app/im/conversations/group-1"],
    });

    expect(
      await screen.findByRole("heading", { name: "Design Guild" }),
    ).toBeInTheDocument();

    const panel = await openMemberPanel(user);

    await waitFor(() => {
      expect(listMembers).toHaveBeenCalledWith("group-1");
    });
    expect(await within(panel).findByText("Alice")).toBeInTheDocument();
    expect(within(panel).getByText("@alice")).toBeInTheDocument();
    expect(within(panel).getByText("Bob")).toBeInTheDocument();
    expect(within(panel).getByText("@bob")).toBeInTheDocument();
  });

  it("adds a group member with exact lookup and addMember", async () => {
    const listMembers = vi
      .fn<ApiClient["listMembers"]>()
      .mockResolvedValueOnce([localUser])
      .mockResolvedValueOnce([localUser, charlie]);
    const lookupUser = vi.fn<ApiClient["lookupUser"]>().mockResolvedValue(charlie);
    const addMember = vi
      .fn<ApiClient["addMember"]>()
      .mockResolvedValue(charlie);
    const { user } = await renderImShell({
      apiClient: { addMember, listMembers, lookupUser },
      conversations: [group()],
      initialEntries: ["/app/im/conversations/group-1"],
    });

    expect(
      await screen.findByRole("heading", { name: "Design Guild" }),
    ).toBeInTheDocument();

    const panel = await openMemberPanel(user);
    await user.type(within(panel).getByLabelText("Username"), "charlie");
    await user.click(within(panel).getByRole("button", { name: "Add member" }));

    await waitFor(() => {
      expect(lookupUser).toHaveBeenCalledWith("charlie");
    });
    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith("group-1", {
        user_id: "1003",
      });
    });
    expect(await within(panel).findByText("Charlie")).toBeInTheDocument();
    expect(within(panel).getByText("@charlie")).toBeInTheDocument();
  });

  it("leaves a group, clears the current conversation, shows a notice, navigates home, and invalidates conversations", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const listConversations = vi
      .fn<ApiClient["listConversations"]>()
      .mockResolvedValueOnce([group()])
      .mockResolvedValueOnce([]);
    const listMembers = vi
      .fn<ApiClient["listMembers"]>()
      .mockResolvedValue([localUser, bob]);
    const leaveGroup = vi.fn<ApiClient["leaveGroup"]>().mockResolvedValue();
    const { router, user } = await renderImShell({
      apiClient: { leaveGroup, listMembers },
      initialEntries: ["/app/im/conversations/group-1"],
      listConversations,
    });

    expect(
      await screen.findByRole("heading", { name: "Design Guild" }),
    ).toBeInTheDocument();

    const panel = await openMemberPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Leave group" }));

    await waitFor(() => {
      expect(leaveGroup).toHaveBeenCalledWith("group-1");
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/app/im");
    });
    expect(useImStore.getState().currentConversationId).toBeNull();
    expect(useImStore.getState().directDraft).toBeNull();
    expect(useImStore.getState().mobilePanel).toBe("conversations");
    expect(await screen.findByText("You left the group.")).toBeInTheDocument();
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalledTimes(2);
    });
  });
});
