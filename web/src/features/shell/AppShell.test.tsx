import { screen, waitFor } from "@testing-library/react";
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
import type { UserSummary } from "@/shared/api/types";

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

describe("AppShell", () => {
  beforeEach(() => {
    useImStore.getState().reset();
    window.localStorage.clear();
  });

  it("renders the desktop feature rail, conversation list region, and main workspace", async () => {
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    expect(await screen.findByLabelText("Feature rail")).toBeInTheDocument();
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
  });

  it("shows a connection status banner for realtime reconnection states", async () => {
    useImStore.getState().setRealtimeStatus("reconnecting");

    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reconnecting…",
    );
  });

  it("treats the user actions popup as a disclosure and closes it with Escape", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    const trigger = await screen.findByRole("button", { name: /User menu/i });

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

  it("changes language from the user menu", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await user.click(await screen.findByRole("button", { name: /User menu/i }));
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

    await user.click(await screen.findByRole("button", { name: /User menu/i }));
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
      user_id: "user-1",
      username: "alice",
      display_name: "Alicia Keys",
    };
    const patchMe = vi.fn().mockResolvedValue(updatedUser);
    const { sessionStore } = await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse({ username: "alice", displayName: "Alice" }),
      apiClient: createShellApiClient({ patchMe }),
    });

    await user.click(await screen.findByRole("button", { name: /User menu/i }));
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
