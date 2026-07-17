import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import { createFakeApiClient, createMemorySessionStore } from "@/app/test-utils";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import { createAppI18n } from "@/shared/i18n/i18n";
import type { RealtimeIncoming } from "./protocol";
import { RealtimeClient, type RealtimeStatus } from "./realtimeClient";
import { useRealtimeBridge } from "./useRealtimeBridge";

class FakeRealtimeClient {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  private readonly eventListeners = new Set<Parameters<RealtimeClient["subscribe"]>[0]>();
  private readonly statusListeners = new Set<
    Parameters<RealtimeClient["subscribeStatus"]>[0]
  >();

  constructor(private status: RealtimeStatus = "connected") {}

  getStatus() {
    return this.status;
  }

  subscribe(listener: Parameters<RealtimeClient["subscribe"]>[0]) {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeStatus(listener: Parameters<RealtimeClient["subscribeStatus"]>[0]) {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  emit(event: RealtimeIncoming) {
    this.eventListeners.forEach((listener) => {
      listener(event);
    });
  }
}

describe("useRealtimeBridge", () => {
  beforeEach(() => {
    localStorage.clear();
    notificationInstances.length = 0;
    useImStore.getState().reset();
  });

  afterEach(() => {
    restoreNotificationGlobal();
    vi.restoreAllMocks();
  });

  it("focuses and navigates to the message conversation when a message notification is clicked", async () => {
    const queryClient = createQueryClient();
    const realtimeClient = new FakeRealtimeClient("connected");
    installNotificationMock();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    useImStore.getState().setBrowserNotificationsEnabled(true);

    const { router } = await renderBridge({ queryClient, realtimeClient });
    await waitFor(() => {
      expect(realtimeClient.connect).toHaveBeenCalledWith({
        access_token: "access-token-1",
      });
    });

    act(() => {
      realtimeClient.emit(
        messageCreated({ conversationId: "conversation-other", senderId: "1002" }),
      );
    });
    expect(notificationInstances).toHaveLength(1);

    act(() => {
      notificationInstances[0].onclick?.(new Event("click"));
    });

    expect(focus).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/app/im/conversations/conversation-other",
      );
    });
  });

  it("focuses the app window when a call notification is clicked without navigating", async () => {
    const queryClient = createQueryClient();
    const realtimeClient = new FakeRealtimeClient("connected");
    installNotificationMock();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    useImStore.getState().setBrowserNotificationsEnabled(true);

    const { router } = await renderBridge({ queryClient, realtimeClient });
    await waitFor(() => {
      expect(realtimeClient.connect).toHaveBeenCalledWith({
        access_token: "access-token-1",
      });
    });

    act(() => {
      realtimeClient.emit(callIncoming({ calleeId: "1001" }));
    });
    expect(notificationInstances).toHaveLength(1);

    act(() => {
      notificationInstances[0].onclick?.(new Event("click"));
    });

    expect(focus).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/app/im");
  });

  it.each([
    {
      name: "window focus",
      dispatchRecoverySignal: () => {
        window.dispatchEvent(new Event("focus"));
      },
    },
    {
      name: "browser online",
      dispatchRecoverySignal: () => {
        window.dispatchEvent(new Event("online"));
      },
    },
    {
      name: "document becoming visible",
      dispatchRecoverySignal: () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      },
    },
  ])(
    "invalidates authoritative IM queries after $name while realtime is connected",
    async ({ dispatchRecoverySignal }) => {
      const queryClient = createQueryClient();
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
      const realtimeClient = new FakeRealtimeClient("connected");
      useImStore.getState().setCurrentConversationId("conversation-1");

      await renderBridge({ queryClient, realtimeClient });
      await waitFor(() => {
        expect(realtimeClient.connect).toHaveBeenCalledWith({
          access_token: "access-token-1",
        });
      });
      invalidateQueries.mockClear();

      dispatchRecoverySignal();

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: imQueryKeys.conversations(),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: imQueryKeys.messages("conversation-1"),
      });
    },
  );
});

function BridgeMount({ client }: { client: RealtimeClient }) {
  useRealtimeBridge({ client });

  return null;
}

async function renderBridge({
  initialEntries = ["/app/im"],
  queryClient,
  realtimeClient,
}: {
  initialEntries?: string[];
  queryClient: ReturnType<typeof createQueryClient>;
  realtimeClient: FakeRealtimeClient;
}) {
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: <BridgeMount client={realtimeClient as unknown as RealtimeClient} />,
      },
    ],
    { initialEntries },
  );

  return {
    router,
    ...render(
      <AppProviders
        apiClient={createFakeApiClient()}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={createMemorySessionStore({
          access_token: "access-token-1",
          client_id: "client-1",
          expires_at: "2999-01-01T00:00:00.000Z",
          user: {
            user_id: "1001",
            username: "alice",
            display_name: "Alice",
          },
        })}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

type NotificationInstance = Notification & {
  onclick: ((event: Event) => void) | null;
};

const notificationInstances: NotificationInstance[] = [];
let originalNotificationDescriptor: PropertyDescriptor | undefined;

function installNotificationMock() {
  originalNotificationDescriptor ??= Object.getOwnPropertyDescriptor(
    globalThis,
    "Notification",
  );

  const NotificationMock = vi.fn(function (this: NotificationInstance) {
    this.onclick = null;
    notificationInstances.push(this);
  });

  Object.defineProperty(NotificationMock, "permission", {
    configurable: true,
    value: "granted",
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: NotificationMock,
  });
}

function restoreNotificationGlobal() {
  notificationInstances.length = 0;

  if (originalNotificationDescriptor) {
    Object.defineProperty(globalThis, "Notification", originalNotificationDescriptor);
  } else {
    delete (globalThis as { Notification?: typeof Notification }).Notification;
  }
  originalNotificationDescriptor = undefined;
}

function messageCreated({
  conversationId,
  senderId,
}: {
  conversationId: string;
  senderId: string;
}): RealtimeIncoming {
  return {
    type: "message.created",
    payload: {
      conversation_id: conversationId,
      message: {
        message_id: `message-${conversationId}-${senderId}`,
        conversation_id: conversationId,
        message_seq: 1,
        sender: {
          user_id: senderId,
          username: senderId === "1001" ? "alice" : "bob",
          display_name: senderId === "1001" ? "Alice" : "Bob",
        },
        body: "Hi",
        message_type: "text",
        metadata: {},
        created_at: "2026-07-01T00:00:00.000Z",
      },
    },
  };
}

function callIncoming({ calleeId }: { calleeId: string }): RealtimeIncoming {
  return {
    type: "call.incoming",
    payload: {
      call: {
        call_id: "call-1",
        conversation_id: "conversation-other",
        caller: {
          user_id: "1002",
          username: "bob",
          display_name: "Bob",
        },
        callee: {
          user_id: calleeId,
          username: calleeId === "1001" ? "alice" : "carol",
          display_name: calleeId === "1001" ? "Alice" : "Carol",
        },
        caller_client_id: "caller-client-1",
        accepted_client_id: null,
        media_type: "audio",
        state: "ringing",
        started_at: "2026-07-01T00:00:00.000Z",
        accepted_at: null,
        ended_at: null,
        end_reason: null,
      },
    },
  };
}
