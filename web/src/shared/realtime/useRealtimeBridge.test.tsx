import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import { createFakeApiClient, createMemorySessionStore } from "@/app/test-utils";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import { createAppI18n } from "@/shared/i18n/i18n";
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
}

describe("useRealtimeBridge", () => {
  beforeEach(() => {
    useImStore.getState().reset();
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
  queryClient,
  realtimeClient,
}: {
  queryClient: ReturnType<typeof createQueryClient>;
  realtimeClient: FakeRealtimeClient;
}) {
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });

  return render(
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
      <BridgeMount client={realtimeClient as unknown as RealtimeClient} />
    </AppProviders>,
  );
}
