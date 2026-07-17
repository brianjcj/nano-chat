import { afterEach, describe, expect, it, vi } from "vitest";

import type { RealtimeIncoming } from "@/shared/realtime/protocol";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  shouldNotifyForRealtimeEvent,
  showBrowserNotification,
} from "./browserNotifications";

describe("browser notification permission", () => {
  afterEach(() => {
    restoreNotificationGlobal();
  });

  it("reports unsupported and skips permission requests when Notification is missing", async () => {
    installNotificationGlobal(undefined);

    expect(getBrowserNotificationPermission()).toBe("unsupported");
    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "unsupported",
    );
  });

  it("requests permission only from the default browser state", async () => {
    let permission: NotificationPermission = "default";
    const requestPermission = vi.fn(async () => {
      permission = "granted";
      return permission;
    });
    installNotificationGlobal(createNotificationMock(() => permission, requestPermission));

    await expect(requestBrowserNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);

    await expect(requestBrowserNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("shows notifications only when enabled and browser permission is granted", () => {
    const NotificationMock = createNotificationMock(() => "granted");
    installNotificationGlobal(NotificationMock);

    showBrowserNotification({
      body: "Hi",
      enabled: false,
      tag: "message-1",
      title: "Bob",
    });
    expect(NotificationMock).not.toHaveBeenCalled();

    showBrowserNotification({
      body: "Hi",
      enabled: true,
      tag: "message-1",
      title: "Bob",
    });
    expect(NotificationMock).toHaveBeenCalledWith("Bob", {
      body: "Hi",
      tag: "message-1",
    });
  });

  it("wires notification click callbacks", () => {
    const onClick = vi.fn();
    const NotificationMock = createNotificationMock(() => "granted");
    installNotificationGlobal(NotificationMock);

    showBrowserNotification({
      enabled: true,
      onClick,
      title: "Bob",
    });
    const [notification] = NotificationMock.mock.instances as Notification[];

    notification.onclick?.(new Event("click"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("realtime notification filtering", () => {
  it("notifies only for messages outside the current conversation from another user", () => {
    const context = {
      currentConversationId: "conversation-current",
      currentUserId: "1001",
    };

    expect(
      shouldNotifyForRealtimeEvent(
        messageCreated({ conversationId: "conversation-other", senderId: "1002" }),
        context,
      ),
    ).toBe(true);
    expect(
      shouldNotifyForRealtimeEvent(
        messageCreated({ conversationId: "conversation-current", senderId: "1002" }),
        context,
      ),
    ).toBe(false);
    expect(
      shouldNotifyForRealtimeEvent(
        messageCreated({ conversationId: "conversation-other", senderId: "1001" }),
        context,
      ),
    ).toBe(false);
  });

  it("notifies only for incoming call events where the current user is the callee", () => {
    const context = {
      currentConversationId: "conversation-current",
      currentUserId: "1001",
    };

    expect(
      shouldNotifyForRealtimeEvent(callEvent("call.incoming", { calleeId: "1001" }), context),
    ).toBe(true);
    expect(
      shouldNotifyForRealtimeEvent(callEvent("call.incoming", { calleeId: "1003" }), context),
    ).toBe(false);
    expect(
      shouldNotifyForRealtimeEvent(
        callEvent("call.incoming", { calleeId: "1001", callerId: "1001" }),
        context,
      ),
    ).toBe(false);
    expect(
      shouldNotifyForRealtimeEvent(callEvent("call.ringing", { calleeId: "1001" }), context),
    ).toBe(false);
  });
});

let originalNotificationDescriptor: PropertyDescriptor | undefined;

function installNotificationGlobal(value: typeof Notification | undefined) {
  originalNotificationDescriptor ??= Object.getOwnPropertyDescriptor(
    globalThis,
    "Notification",
  );

  if (value === undefined) {
    delete (globalThis as { Notification?: typeof Notification }).Notification;
    return;
  }

  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value,
  });
}

function restoreNotificationGlobal() {
  if (originalNotificationDescriptor) {
    Object.defineProperty(globalThis, "Notification", originalNotificationDescriptor);
  } else {
    delete (globalThis as { Notification?: typeof Notification }).Notification;
  }
  originalNotificationDescriptor = undefined;
}

function createNotificationMock(
  getPermission: () => NotificationPermission,
  requestPermission = vi.fn(async () => getPermission()),
) {
  const NotificationMock = vi.fn(function (this: Notification) {});

  Object.defineProperty(NotificationMock, "permission", {
    configurable: true,
    get: getPermission,
  });
  Object.defineProperty(NotificationMock, "requestPermission", {
    configurable: true,
    value: requestPermission,
  });

  return NotificationMock as unknown as typeof Notification & ReturnType<typeof vi.fn>;
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

function callEvent(
  type:
    | "call.incoming"
    | "call.ringing"
    | "call.accepted"
    | "call.connected"
    | "call.rejected"
    | "call.canceled"
    | "call.ended"
    | "call.busy",
  {
    calleeId,
    callerId = "1002",
  }: {
    calleeId: string;
    callerId?: string;
  },
): RealtimeIncoming {
  return {
    type,
    payload: {
      call: {
        call_id: "call-1",
        conversation_id: "conversation-other",
        caller: {
          user_id: callerId,
          username: callerId === "1001" ? "alice" : "bob",
          display_name: callerId === "1001" ? "Alice" : "Bob",
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
