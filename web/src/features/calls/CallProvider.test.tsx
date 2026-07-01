import userEvent from "@testing-library/user-event";
import { type PropsWithChildren } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import { createQueryClient } from "@/app/queryClient";
import {
  createFakeApiClient,
  createMemorySessionStore,
  makeAuthResponse,
  render,
  screen,
  waitFor,
  act,
} from "@/app/test-utils";
import { CallProvider, useCall, type CallEnginePort } from "./CallProvider";
import type { ApiClient } from "@/shared/api/client";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import type { CallSummary, RealtimeIncoming } from "@/shared/realtime/protocol";
import type { RealtimeClient } from "@/shared/realtime/realtimeClient";

const localUser: UserSummary = {
  user_id: "1001",
  username: "alice",
  display_name: "Alice",
};

const remoteUser: UserSummary = {
  user_id: "1002",
  username: "bob",
  display_name: "Bob",
};

beforeAll(() => {
  if (!("MediaStream" in globalThis)) {
    vi.stubGlobal("MediaStream", TestMediaStream);
  }
});

const directConversation: ConversationSummary = {
  conversation_id: "conversation-1",
  type: "direct",
  name: null,
  state: "active",
  latest_message_seq: 0,
  read_seq: 0,
  unread_count: 0,
  active_member_count: 2,
  direct_user: remoteUser,
  latest_message: null,
};

describe("CallProvider", () => {
  it("sends call.invite after media permission succeeds", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const apiClient = createFakeApiClient();
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <StartCallProbe conversation={directConversation} mediaType="audio" />
      </CallProvider>,
      { apiClient, realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));

    expect(engine.prepareLocalMedia).toHaveBeenCalledWith("audio");
    expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.invite", {
      conversation_id: directConversation.conversation_id,
      media_type: "audio",
    });
  });

  it("does not send call.invite when media permission is denied", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    engine.prepareLocalMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    await renderWithProviders(
      <CallProvider engine={engine}>
        <StartCallProbe conversation={directConversation} mediaType="video" />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));

    await waitFor(() => {
      expect(engine.prepareLocalMedia).toHaveBeenCalledWith("video");
    });
    expect(realtimeClient.sendCommand).not.toHaveBeenCalled();
  });

  it("sends an offer signal when the caller receives call.accepted", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <StartCallProbe conversation={directConversation} mediaType="video" />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    act(() => {
      realtimeClient.emit({
        type: "call.accepted",
        payload: { call: createCallSummary({ state: "connecting" }) },
      });
    });

    await waitFor(() => {
      expect(engine.createOffer).toHaveBeenCalled();
    });
    expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.signal", {
      call_id: "call-1",
      signal_type: "offer",
      data: { type: "offer", sdp: "v=0" },
    });
  });
});

function StartCallProbe({
  conversation,
  mediaType,
}: {
  conversation: ConversationSummary;
  mediaType: "audio" | "video";
}) {
  const { startCall } = useCall();

  return (
    <button onClick={() => void startCall(conversation, mediaType)} type="button">
      start
    </button>
  );
}

async function renderWithProviders(
  ui: React.ReactElement,
  {
    apiClient = createFakeApiClient(),
    realtimeClient = createFakeRealtimeClient(),
  }: {
    apiClient?: ApiClient;
    realtimeClient?: ReturnType<typeof createFakeRealtimeClient>;
  } = {},
) {
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });

  return render(
    <RealtimeClientProvider client={realtimeClient as unknown as RealtimeClient}>
      {ui}
    </RealtimeClientProvider>,
    {
      wrapper({ children }: PropsWithChildren) {
        return (
          <AppProviders
            apiClient={apiClient}
            i18nInstance={i18nInstance}
            queryClient={createQueryClient()}
            sessionStore={createMemorySessionStore(
              makeAuthResponse({
                clientId: "caller-client-1",
                displayName: localUser.display_name,
                userId: localUser.user_id,
                username: localUser.username,
              }),
            )}
          >
            {children}
          </AppProviders>
        );
      },
    },
  );
}

function createFakeCallEngine() {
  return {
    prepareLocalMedia: vi.fn().mockResolvedValue(new MediaStream()),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
    acceptOffer: vi.fn().mockResolvedValue({ type: "answer", sdp: "v=0" }),
    acceptAnswer: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    toggleMuted: vi.fn().mockReturnValue(true),
    toggleCamera: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  } satisfies CallEnginePort;
}

function createFakeRealtimeClient() {
  const listeners = new Set<(event: RealtimeIncoming) => void>();
  const client = {
    sendCommand: vi.fn((type: string) => {
      if (type === "call.invite") {
        return Promise.resolve({ call: createCallSummary({ state: "ringing" }) });
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    }),
    subscribe: vi.fn((listener: (event: RealtimeIncoming) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    }),
    subscribeStatus: vi.fn(() => () => undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn(() => "connected"),
    emit(event: RealtimeIncoming) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };

  return client;
}

function createCallSummary(overrides: Partial<CallSummary> = {}) {
  return {
    ...createCallSummaryShape(),
    ...overrides,
  };
}

function createCallSummaryShape(): CallSummary {
  return {
    call_id: "call-1",
    conversation_id: directConversation.conversation_id,
    caller: localUser,
    callee: remoteUser,
    caller_client_id: "caller-client-1",
    accepted_client_id: null,
    media_type: "video" as const,
    state: "ringing",
    started_at: "2026-07-01T00:00:00.000Z",
    accepted_at: null,
    ended_at: null,
    end_reason: null,
  };
}

class TestMediaStream {
  private readonly tracks: MediaStreamTrack[] = [];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks.push(...tracks);
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}
