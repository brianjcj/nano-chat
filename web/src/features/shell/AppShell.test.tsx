import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFakeApiClient,
  makeAuthResponse,
  renderAppRoute,
} from "@/app/test-utils";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, Message, UserSummary } from "@/shared/api/types";

vi.mock("@/shared/realtime/useRealtimeBridge", () => ({
  useRealtimeBridge: vi.fn(),
}));

function createShellApiClient(overrides: Partial<ApiClient> = {}) {
  return createFakeApiClient({
    listConversations: vi.fn().mockResolvedValue([]),
    patchMe: vi.fn(),
    ...overrides,
  });
}

function getDesktopUserMenuTrigger() {
  return within(screen.getByLabelText("Feature rail")).getByRole("button", {
    name: /User menu/i,
  });
}

function getDesktopSettingsTrigger() {
  return within(screen.getByLabelText("Feature rail")).getByRole("button", {
    name: "Settings",
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useImStore.getState().reset();
  });

  it("renders the chat workspace when loading an authenticated conversation route", async () => {
    const remoteUser: UserSummary = {
      user_id: "1002",
      username: "bob",
      display_name: "Bob",
    };
    const conversation: ConversationSummary = {
      conversation_id: "conversation-1",
      type: "direct",
      name: null,
      state: "active",
      latest_message_seq: 1,
      read_seq: 1,
      unread_count: 0,
      active_member_count: 2,
      direct_user: remoteUser,
      latest_message: {
        message_id: "message-1",
        message_seq: 1,
        sender: remoteUser,
        body: "Hi from the routed conversation",
        message_type: "text",
        metadata: {},
        created_at: "2026-06-14T00:00:00.000Z",
      },
    };
    const routeMessage: Message = {
      message_id: "message-1",
      conversation_id: "conversation-1",
      message_seq: 1,
      sender: remoteUser,
      body: "Hi from the routed conversation",
      message_type: "text",
      metadata: {},
      created_at: "2026-06-14T00:00:00.000Z",
    };
    const listConversations = vi.fn().mockResolvedValue([conversation]);
    const listMessages = vi.fn().mockResolvedValue([routeMessage]);
    const { router } = await renderAppRoute({
      initialEntries: ["/app/im/conversations/conversation-1"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient({ listConversations, listMessages }),
    });

    expect(
      await screen.findByRole("main", { name: "Main workspace" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(await screen.findByText("Direct chat")).toBeInTheDocument();
    expect(
      await screen.findByText("Hi from the routed conversation"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/app/im/conversations/conversation-1",
    );
    expect(useImStore.getState().currentConversationId).toBe("conversation-1");
  });

  it("renders the desktop feature rail, conversation list region, and main workspace", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const featureRail = await screen.findByLabelText("Feature rail");

    expect(featureRail).toBeInTheDocument();
    expect(
      within(featureRail).getByRole("button", { name: /User menu/i }),
    ).toBeInTheDocument();
    expect(
      within(featureRail).getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation list")).toBeInTheDocument();
    expect(
      screen.getByRole("main", { name: "Main workspace" }),
    ).toBeInTheDocument();
  });

  it("bounds the shell height and scrolls only the conversation list body", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const listRegion = await screen.findByLabelText("Conversation list");
    const listPanel = listRegion.closest("aside");
    const shellContent = listPanel?.parentElement;
    const shellFrame = shellContent?.parentElement;
    const shellRoot = shellFrame?.parentElement;
    const listBody = listRegion.children.item(1);

    expect(shellRoot).toHaveClass("h-dvh", "overflow-hidden");
    expect(shellFrame).toHaveClass("h-full", "min-h-0");
    expect(shellContent).toHaveClass("min-h-0");
    expect(listPanel).toHaveClass("h-full", "min-h-0", "flex-col");
    expect(listRegion).toHaveClass("h-full", "min-h-0", "flex-1");
    expect(listBody).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });

  it("renders the mobile bottom feature bar and keeps the desktop rail hidden until the desktop breakpoint", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const featureRail = await screen.findByLabelText("Feature rail");
    const mobileFeatureBar = screen.getByLabelText("Mobile feature bar");

    expect(featureRail).toHaveClass("hidden", "md:flex");
    expect(mobileFeatureBar).toHaveClass("md:hidden");
    expect(
      within(mobileFeatureBar).getByRole("button", { name: /User menu/i }),
    ).toBeInTheDocument();
    expect(
      within(mobileFeatureBar).getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("opens shell settings and toggles message sequence numbers", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    const trigger = getDesktopSettingsTrigger();

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const popup = screen.getByRole("region", { name: "Settings" });
    const sequenceSwitch = within(popup).getByRole("switch", {
      name: "Show message sequence numbers",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(sequenceSwitch).toHaveAttribute("aria-checked", "false");

    await user.click(sequenceSwitch);

    expect(sequenceSwitch).toHaveAttribute("aria-checked", "true");
    expect(useImStore.getState().showMessageSequenceNumbers).toBe(true);
    expect(
      window.localStorage.getItem("nano-chat:show-message-sequence-numbers"),
    ).toBe("true");
  });

  it("shows translated connection status banners for realtime reconnection states", async () => {
    useImStore.getState().setRealtimeStatus("reconnecting");

    const { i18n } = await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reconnecting…",
    );

    await i18n.changeLanguage("zh-CN");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "正在重新连接…",
    );
  });

  it("hides the username handle when the user menu primary name is already the username", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse({ username: "jcj", displayName: null }),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    await user.click(getDesktopUserMenuTrigger());

    const popup = screen.getByRole("region", { name: "User menu" });
    expect(within(popup).getByText("jcj")).toBeInTheDocument();
    expect(within(popup).queryByText("@jcj")).not.toBeInTheDocument();
  });

  it("treats the user actions popup as a disclosure and closes it with Escape", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    const trigger = getDesktopUserMenuTrigger();

    expect(trigger).not.toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const popup = screen.getByRole("region", { name: "User menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", popup.id);

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("region", { name: "User menu" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the user actions popup after clicking outside it", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    const trigger = getDesktopUserMenuTrigger();
    await user.click(trigger);

    expect(screen.getByRole("region", { name: "User menu" })).toBeInTheDocument();

    await user.click(screen.getByRole("main", { name: "Main workspace" }));

    expect(
      screen.queryByRole("region", { name: "User menu" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("changes language from the user menu", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    await user.click(getDesktopUserMenuTrigger());
    await user.click(screen.getByRole("button", { name: "中文" }));

    expect(await screen.findByLabelText("功能栏")).toBeInTheDocument();
    expect(window.localStorage.getItem("nano-chat.language")).toBe("zh-CN");
  });

  it("logs out from the user menu by clearing session and leaving the authenticated area", async () => {
    const user = userEvent.setup();
    const { queryClient, router, sessionStore } = await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });
    await screen.findByText("No conversations yet");
    const cachedConversations = [
      {
        active_member_count: 1,
        conversation_id: "cached-conversation",
        direct_user: null,
        latest_message: null,
        latest_message_seq: 0,
        name: "Cached group",
        read_seq: 0,
        state: "active" as const,
        type: "group" as const,
        unread_count: 0,
      },
    ];
    queryClient.setQueryData(imQueryKeys.conversations(), cachedConversations);
    expect(queryClient.getQueryData(imQueryKeys.conversations())).toEqual(
      cachedConversations,
    );

    await screen.findByLabelText("Feature rail");
    await user.click(getDesktopUserMenuTrigger());
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(sessionStore.getValidSession()).toBeNull();
    expect(
      queryClient.getQueryData(imQueryKeys.conversations()),
    ).toBeUndefined();
    expect(useImStore.getState().currentConversationId).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Sign in to Nano Chat" }),
    ).toBeInTheDocument();
  });

  it("edits display name from the user menu, saves the returned user into session, and updates visible name", async () => {
    const user = userEvent.setup();
    const updatedUser: UserSummary = {
      user_id: "1001",
      username: "alice",
      display_name: "Alicia Keys",
    };
    const patchMe = vi.fn().mockResolvedValue(updatedUser);
    const { sessionStore } = await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse({ username: "alice", displayName: "Alice" }),
      apiClient: createShellApiClient({ patchMe }),
    });

    await screen.findByLabelText("Feature rail");
    await user.click(getDesktopUserMenuTrigger());
    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "Alicia Keys");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchMe).toHaveBeenCalledWith({ display_name: "Alicia Keys" });
    });
    expect(sessionStore.getValidSession()?.user).toEqual(updatedUser);
    expect(await screen.findByText("Alicia Keys")).toBeInTheDocument();
  });
});
