import type { RealtimeIncoming } from "@/shared/realtime/protocol";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

type NotificationContext = {
  currentConversationId: string | null;
  currentUserId: string | null | undefined;
};

type ShowBrowserNotificationOptions = {
  body?: string;
  enabled: boolean;
  onClick?: (event: Event) => void;
  tag?: string;
  title: string;
};

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  const NotificationApi = getNotificationApi();

  return NotificationApi?.permission ?? "unsupported";
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  const NotificationApi = getNotificationApi();

  if (!NotificationApi) {
    return "unsupported";
  }

  if (NotificationApi.permission !== "default") {
    return NotificationApi.permission;
  }

  return NotificationApi.requestPermission();
}

export function showBrowserNotification({
  body,
  enabled,
  onClick,
  tag,
  title,
}: ShowBrowserNotificationOptions): Notification | undefined {
  const NotificationApi = getNotificationApi();

  if (!enabled || !NotificationApi || NotificationApi.permission !== "granted") {
    return undefined;
  }

  const notification = new NotificationApi(title, { body, tag });

  if (onClick) {
    notification.onclick = onClick;
  }

  return notification;
}

export function shouldNotifyForRealtimeEvent(
  event: RealtimeIncoming,
  { currentConversationId, currentUserId }: NotificationContext,
): boolean {
  if (!currentUserId) {
    return false;
  }

  if (event.type === "message.created") {
    return (
      event.payload.conversation_id !== currentConversationId &&
      event.payload.message.sender.user_id !== currentUserId
    );
  }

  if (event.type === "call.incoming") {
    const { call } = event.payload;

    return (
      call.callee.user_id === currentUserId &&
      call.caller.user_id !== currentUserId
    );
  }

  return false;
}

function getNotificationApi(): typeof Notification | undefined {
  return typeof globalThis.Notification === "function"
    ? globalThis.Notification
    : undefined;
}
