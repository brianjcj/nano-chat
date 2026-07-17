import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useSession } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { applyRealtimeEvent } from "@/features/im/state/cacheUpdates";
import { useImStore } from "@/features/im/state/imStore";
import { getAppEnv } from "@/shared/config/env";
import {
  shouldNotifyForRealtimeEvent,
  showBrowserNotification,
} from "@/shared/notifications/browserNotifications";
import type { UserSummary } from "@/shared/api/types";
import { RealtimeClient, type RealtimeStatus } from "./realtimeClient";
import type { RealtimeIncoming } from "./protocol";
import { useOptionalRealtimeClient } from "./RealtimeClientContext";

type UseRealtimeBridgeOptions = {
  client?: RealtimeClient;
};

export function useRealtimeBridge(options: UseRealtimeBridgeOptions = {}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { getValidSession } = useSession();
  const setRealtimeStatus = useImStore((state) => state.setRealtimeStatus);
  const contextClient = useOptionalRealtimeClient();
  const wsUrl = useMemo(() => getAppEnv().wsUrl, []);
  const defaultClient = useMemo(() => new RealtimeClient({ wsUrl }), [wsUrl]);
  const client = options.client ?? contextClient ?? defaultClient;

  useEffect(() => {
    const session = getValidSession();

    if (!session) {
      client.disconnect();
      setRealtimeStatus("idle");
      return undefined;
    }

    let previousStatus = client.getStatus();

    const unsubscribeStatus = client.subscribeStatus((status) => {
      setRealtimeStatus(status);

      if (shouldSyncAfterStatusChange(previousStatus, status)) {
        invalidateRealtimeAuthoritativeQueries(queryClient);
      }

      previousStatus = status;
    });
    const currentUserId = session.user.user_id;
    const unsubscribeEvents = client.subscribe((event) => {
      const storeState = useImStore.getState();

      if (
        storeState.browserNotificationsEnabled &&
        shouldNotifyForRealtimeEvent(event, {
          currentConversationId: storeState.currentConversationId,
          currentUserId,
        })
      ) {
        showRealtimeNotification(event, t);
      }

      applyRealtimeEvent({
        queryClient,
        store: useImStore,
        currentUserId,
        event,
      });
    });
    const syncAfterBrowserRecovery = () => {
      invalidateRealtimeAuthoritativeQueries(queryClient);
    };
    const syncAfterVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncAfterBrowserRecovery();
      }
    };

    window.addEventListener("focus", syncAfterBrowserRecovery);
    window.addEventListener("online", syncAfterBrowserRecovery);
    document.addEventListener("visibilitychange", syncAfterVisibilityChange);

    client.connect({ access_token: session.access_token });

    return () => {
      document.removeEventListener("visibilitychange", syncAfterVisibilityChange);
      window.removeEventListener("online", syncAfterBrowserRecovery);
      window.removeEventListener("focus", syncAfterBrowserRecovery);
      unsubscribeEvents();
      unsubscribeStatus();
      client.disconnect();
    };
  }, [client, getValidSession, queryClient, setRealtimeStatus, t]);

  return client;
}

function showRealtimeNotification(event: RealtimeIncoming, t: TFunction) {
  if (event.type === "message.created") {
    showBrowserNotification({
      body: event.payload.message.body,
      enabled: true,
      tag: `nano-chat:message:${event.payload.conversation_id}`,
      title: getUserDisplayName(event.payload.message.sender),
    });
    return;
  }

  if (event.type === "call.incoming") {
    const { call } = event.payload;
    const callerName = getUserDisplayName(call.caller);

    showBrowserNotification({
      enabled: true,
      tag: `nano-chat:call:${call.call_id}`,
      title:
        call.media_type === "audio"
          ? t("calls.status.incomingAudio", { name: callerName })
          : t("calls.status.incomingVideo", { name: callerName }),
    });
  }
}

function getUserDisplayName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}

function shouldSyncAfterStatusChange(
  previousStatus: RealtimeStatus,
  nextStatus: RealtimeStatus,
) {
  return (
    nextStatus === "connected" &&
    (previousStatus === "reconnecting" || previousStatus === "draining")
  );
}

function invalidateRealtimeAuthoritativeQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: imQueryKeys.conversations() });

  const currentConversationId = useImStore.getState().currentConversationId;

  if (currentConversationId) {
    void queryClient.invalidateQueries({
      queryKey: imQueryKeys.messages(currentConversationId),
    });
  }
}
