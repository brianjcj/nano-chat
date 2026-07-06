import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { applyRealtimeEvent } from "@/features/im/state/cacheUpdates";
import { useImStore } from "@/features/im/state/imStore";
import { getAppEnv } from "@/shared/config/env";
import { RealtimeClient, type RealtimeStatus } from "./realtimeClient";
import { useOptionalRealtimeClient } from "./RealtimeClientContext";

type UseRealtimeBridgeOptions = {
  client?: RealtimeClient;
};

export function useRealtimeBridge(options: UseRealtimeBridgeOptions = {}) {
  const queryClient = useQueryClient();
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
  }, [client, getValidSession, queryClient, setRealtimeStatus]);

  return client;
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
