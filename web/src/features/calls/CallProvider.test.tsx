import userEvent from "@testing-library/user-event";
import { type PropsWithChildren, type ReactElement } from "react";
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
import {
  CallProvider,
  useCall,
  type CallEnginePort,
} from "./CallProvider";
import { CallEngine, type CallEngineEvent } from "./CallEngine";
import { CallOverlay } from "./components/CallOverlay";
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

    expectMediaPrepared(engine, "audio");
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
      expectMediaPrepared(engine, "video");
    });
    expect(realtimeClient.sendCommand).not.toHaveBeenCalled();
  });

  it("closes partially prepared media when local media preparation fails before invite", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    engine.prepareLocalMedia.mockRejectedValueOnce(new Error("ICE fetch failed"));
    await renderWithProviders(
      <CallProvider engine={engine}>
        <StartCallProbe conversation={directConversation} mediaType="video" />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
    });
    expect(realtimeClient.sendCommand).not.toHaveBeenCalled();
  });

  it("does not invite when another call arrives while media permission is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const mediaDeferred = createDeferred<MediaStream>();
    engine.prepareLocalMedia.mockImplementationOnce(() => mediaDeferred.promise);
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => {
      expectMediaPrepared(engine, "video");
    });

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: createIncomingCallSummary({ call_id: "incoming-call-2" }) },
      });
    });
    await screen.findByText("incoming");

    await act(async () => {
      mediaDeferred.resolve(new MediaStream());
      await mediaDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("incoming");
    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith(
      "call.invite",
      expect.anything(),
    );
  });

  it("ignores incoming calls while the invite response is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const inviteDeferred = createDeferred<{ call: CallSummary }>();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.invite") {
        return inviteDeferred.promise;
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.invite", {
        conversation_id: directConversation.conversation_id,
        media_type: "video",
      });
    });

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: createIncomingCallSummary({ call_id: "incoming-call-2" }) },
      });
    });
    expect(screen.getByTestId("call-phase")).toHaveTextContent("idle");

    await act(async () => {
      inviteDeferred.resolve({
        call: createCallSummary({ call_id: "outgoing-call-2", state: "ringing" }),
      });
      await inviteDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("outgoing");
  });

  it("does not close an accepted incoming call when a stale outgoing start resolves", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary({ call_id: "incoming-call-2" });
    const startMediaDeferred = createDeferred<MediaStream>();
    engine.prepareLocalMedia
      .mockImplementationOnce(() => startMediaDeferred.promise)
      .mockResolvedValueOnce(new MediaStream());
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => {
      expectMediaPrepared(engine, "video");
    });

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });
    await screen.findByText("connecting");
    const closeCallsBeforeStaleStartResolved = engine.close.mock.calls.length;

    await act(async () => {
      startMediaDeferred.resolve(new MediaStream());
      await startMediaDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("connecting");
    expect(engine.close).toHaveBeenCalledTimes(closeCallsBeforeStaleStartResolved);
  });

  it("stops stale outgoing media before it can replace an accepted incoming engine stream", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const incomingCall = createIncomingCallSummary({ call_id: "incoming-call-2" });
    const startMediaDeferred = createDeferred<MediaStream>();
    const staleTrack = createFakeTrack("video");
    const acceptedTrack = createFakeTrack("video");
    const staleStream = new MediaStream([staleTrack]);
    const acceptedStream = new MediaStream([acceptedTrack]);
    const peer = createFakePeerConnection();
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(() => startMediaDeferred.promise)
      .mockResolvedValueOnce(acceptedStream);
    const engine = new CallEngine({
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getIceServers: vi.fn().mockResolvedValue([]),
      getUserMedia,
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    });

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
      expect(peer.addTrack).toHaveBeenCalledWith(acceptedTrack, acceptedStream);
    });
    const addTrackCallsAfterAccept = peer.addTrack.mock.calls.length;

    await act(async () => {
      startMediaDeferred.resolve(staleStream);
      await startMediaDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("connecting");
    expect(staleTrack.stop).toHaveBeenCalled();
    expect(peer.addTrack).toHaveBeenCalledTimes(addTrackCallsAfterAccept);
    expect(peer.addTrack).not.toHaveBeenCalledWith(staleTrack, staleStream);
  });

  it("blocks incoming accept while the outgoing invite is pending and cleans up failed invite media", async () => {
    const inviteDeferred = createDeferred<{ call: CallSummary }>();
    const realtimeClient = createFakeRealtimeClient();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.invite") {
        return inviteDeferred.promise;
      }

      return Promise.resolve({
        call: createIncomingCallSummary({
          state: "connecting",
          accepted_client_id: "caller-client-1",
          accepted_at: "2026-07-01T00:00:15.000Z",
        }),
      });
    });
    const incomingCall = createIncomingCallSummary({ call_id: "incoming-call-2" });
    const outgoingTrack = createFakeTrack("video");
    const incomingTrack = createFakeTrack("video");
    const outgoingStream = new MediaStream([outgoingTrack]);
    const incomingStream = new MediaStream([incomingTrack]);
    const peer = createFakePeerConnection();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(outgoingStream)
      .mockResolvedValueOnce(incomingStream);
    const engine = new CallEngine({
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getIceServers: vi.fn().mockResolvedValue([]),
      getUserMedia,
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.invite", {
        conversation_id: directConversation.conversation_id,
        media_type: "video",
      });
      expect(peer.addTrack).toHaveBeenCalledWith(outgoingTrack, outgoingStream);
    });

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await userEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith("call.accept", {
      call_id: incomingCall.call_id,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(peer.addTrack).not.toHaveBeenCalledWith(incomingTrack, incomingStream);

    await act(async () => {
      inviteDeferred.reject(new Error("call.invite failed"));
      await inviteDeferred.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("idle");
    expect(outgoingTrack.stop).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
  });

  it("does not prepare local media or send duplicate invites while a start is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const mediaDeferred = createDeferred<MediaStream>();
    engine.prepareLocalMedia.mockImplementation(() => mediaDeferred.promise);
    await renderWithProviders(
      <CallProvider engine={engine}>
        <StartCallProbe conversation={directConversation} mediaType="video" />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await userEvent.click(screen.getByRole("button", { name: "start" }));

    expect(engine.prepareLocalMedia).toHaveBeenCalledTimes(1);
    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith(
      "call.invite",
      expect.anything(),
    );

    await act(async () => {
      mediaDeferred.resolve(new MediaStream());
      await mediaDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      realtimeClient.sendCommand.mock.calls.filter(([type]) => type === "call.invite"),
    ).toHaveLength(1);
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

  it("ignores late state-advance and signal events after a call ended", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByText("outgoing");

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    act(() => {
      realtimeClient.emit({
        type: "call.ringing",
        payload: { call: createCallSummary({ state: "ringing" }) },
      });
      realtimeClient.emit({
        type: "call.accepted",
        payload: { call: createCallSummary({ state: "connecting" }) },
      });
      realtimeClient.emit({
        type: "call.connected",
        payload: { call: createCallSummary({ state: "active" }) },
      });
      realtimeClient.emit({
        type: "call.signal",
        payload: {
          call_id: "call-1",
          signal_type: "offer",
          data: { type: "offer", sdp: "v=0" },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
    expect(engine.createOffer).not.toHaveBeenCalled();
    expect(engine.acceptOffer).not.toHaveBeenCalled();
  });

  it("queues caller ICE candidates until the offer signal is sent", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    engine.createOffer.mockImplementationOnce(async () => {
      engine.emit({
        type: "ice_candidate",
        candidate: { candidate: "candidate:caller" },
      });
      return { type: "offer", sdp: "v=0" };
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
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
      expect(getSignalTypes(realtimeClient)).toEqual(["offer", "ice_candidate"]);
    });
  });

  it("answers offers as callee and queues ICE until the answer signal is sent", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    engine.acceptOffer.mockImplementationOnce(async () => {
      engine.emit({
        type: "ice_candidate",
        candidate: { candidate: "candidate:callee" },
      });
      return { type: "answer", sdp: "v=0" };
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));

    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });

    act(() => {
      realtimeClient.emit({
        type: "call.signal",
        payload: {
          call_id: incomingCall.call_id,
          signal_type: "offer",
          data: { type: "offer", sdp: "v=0" },
        },
      });
    });

    await waitFor(() => {
      expect(engine.acceptOffer).toHaveBeenCalledWith({ type: "offer", sdp: "v=0" });
      expect(getSignalTypes(realtimeClient)).toEqual(["answer", "ice_candidate"]);
    });
  });

  it("does not accept when an incoming call ends while media permission is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const mediaDeferred = createDeferred<MediaStream>();
    engine.prepareLocalMedia.mockImplementationOnce(() => mediaDeferred.promise);
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expectMediaPrepared(engine, incomingCall.media_type);
    });

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createIncomingCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    await act(async () => {
      mediaDeferred.resolve(new MediaStream());
      await mediaDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith("call.accept", {
      call_id: incomingCall.call_id,
    });
  });

  it("does not overwrite ended state when call.accept resolves after the call ends", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const acceptDeferred = createDeferred<{ call: CallSummary }>();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.accept") {
        return acceptDeferred.promise;
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });
    await screen.findByText("connecting");

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createIncomingCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    await act(async () => {
      acceptDeferred.resolve({
        call: createIncomingCallSummary({
          state: "connecting",
          accepted_client_id: "caller-client-1",
          accepted_at: "2026-07-01T00:00:15.000Z",
        }),
      });
      await acceptDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
  });

  it("does not restore incoming when call.accept fails after the call ends", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const acceptDeferred = createDeferred<{ call: CallSummary }>();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.accept") {
        return acceptDeferred.promise;
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });
    await screen.findByText("connecting");

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createIncomingCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    await act(async () => {
      acceptDeferred.reject(new Error("call.accept failed"));
      await acceptDeferred.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
  });

  it("does not restore incoming when call.accept rejects after realtime advances the call", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const acceptDeferred = createDeferred<{ call: CallSummary }>();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.accept") {
        return acceptDeferred.promise;
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });

    act(() => {
      realtimeClient.emit({
        type: "call.accepted",
        payload: {
          call: createIncomingCallSummary({
            state: "connecting",
            accepted_client_id: "caller-client-1",
            accepted_at: "2026-07-01T00:00:15.000Z",
          }),
        },
      });
    });
    await screen.findByText("connecting");
    const closeCallsBeforeReject = engine.close.mock.calls.length;

    await act(async () => {
      acceptDeferred.reject(new Error("call.accept failed"));
      await acceptDeferred.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("connecting");
    expect(engine.close).toHaveBeenCalledTimes(closeCallsBeforeReject);
  });

  it("does not close an active call when call.accept rejects after the engine connects", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const acceptDeferred = createDeferred<{ call: CallSummary }>();
    realtimeClient.sendCommand.mockImplementation((type: string) => {
      if (type === "call.accept") {
        return acceptDeferred.promise;
      }

      return Promise.resolve({ call: createCallSummary({ state: "connecting" }) });
    });
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");

    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(realtimeClient.sendCommand).toHaveBeenCalledWith("call.accept", {
        call_id: incomingCall.call_id,
      });
    });

    act(() => {
      engine.emit({ type: "connected" });
    });
    await screen.findByText("active");
    const closeCallsBeforeReject = engine.close.mock.calls.length;

    await act(async () => {
      acceptDeferred.reject(new Error("call.accept failed"));
      await acceptDeferred.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("active");
    expect(engine.close).toHaveBeenCalledTimes(closeCallsBeforeReject);
  });

  it("does not answer an offer when the call ends while acceptOffer is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    const answerDeferred = createDeferred<RTCSessionDescriptionInit>();
    engine.acceptOffer.mockImplementationOnce(() => answerDeferred.promise);
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");
    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await screen.findByText("connecting");

    act(() => {
      realtimeClient.emit({
        type: "call.signal",
        payload: {
          call_id: incomingCall.call_id,
          signal_type: "offer",
          data: { type: "offer", sdp: "v=0" },
        },
      });
    });
    await waitFor(() => {
      expect(engine.acceptOffer).toHaveBeenCalled();
    });

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createIncomingCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    await act(async () => {
      answerDeferred.resolve({ type: "answer", sdp: "v=0" });
      await answerDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith(
      "call.signal",
      expect.objectContaining({ signal_type: "answer" }),
    );
  });

  it("does not send a caller offer when the call ends while createOffer is pending", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    const offerDeferred = createDeferred<RTCSessionDescriptionInit>();
    engine.createOffer.mockImplementationOnce(() => offerDeferred.promise);
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByText("outgoing");

    act(() => {
      realtimeClient.emit({
        type: "call.accepted",
        payload: { call: createCallSummary({ state: "connecting" }) },
      });
    });
    await waitFor(() => {
      expect(engine.createOffer).toHaveBeenCalled();
    });

    act(() => {
      realtimeClient.emit({
        type: "call.ended",
        payload: {
          call: createCallSummary({
            state: "ended",
            ended_at: "2026-07-01T00:01:00.000Z",
            end_reason: "completed",
          }),
        },
      });
    });
    await screen.findByText("ended");

    await act(async () => {
      offerDeferred.resolve({ type: "offer", sdp: "v=0" });
      await offerDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    expect(realtimeClient.sendCommand).not.toHaveBeenCalledWith(
      "call.signal",
      expect.objectContaining({ signal_type: "offer" }),
    );
  });

  it("cleans up and ends when sending the caller offer signal fails", async () => {
    const realtimeClient = createFakeRealtimeClient({ rejectCommands: ["call.signal"] });
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByText("outgoing");

    act(() => {
      realtimeClient.emit({
        type: "call.accepted",
        payload: { call: createCallSummary({ state: "connecting" }) },
      });
    });

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
  });

  it("cleans up and ends when sending the callee answer signal fails", async () => {
    const realtimeClient = createFakeRealtimeClient({ rejectCommands: ["call.signal"] });
    const engine = createFakeCallEngine();
    const incomingCall = createIncomingCallSummary();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: incomingCall },
      });
    });
    await screen.findByText("incoming");
    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await screen.findByText("connecting");

    act(() => {
      realtimeClient.emit({
        type: "call.signal",
        payload: {
          call_id: incomingCall.call_id,
          signal_type: "offer",
          data: { type: "offer", sdp: "v=0" },
        },
      });
    });

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
  });

  it("cleans up active call state even when hangup command rejects", async () => {
    const realtimeClient = createFakeRealtimeClient({ rejectCommands: ["call.hangup"] });
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByText("outgoing");
    await userEvent.click(screen.getByRole("button", { name: "hang up" }));

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
  });

  it("cleans up outgoing call state even when cancel command rejects", async () => {
    const realtimeClient = createFakeRealtimeClient({ rejectCommands: ["call.cancel"] });
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByText("outgoing");
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
  });

  it("cleans up incoming call state even when reject command rejects", async () => {
    const realtimeClient = createFakeRealtimeClient({ rejectCommands: ["call.reject"] });
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallStateProbe />
      </CallProvider>,
      { realtimeClient },
    );

    act(() => {
      realtimeClient.emit({
        type: "call.incoming",
        payload: { call: createIncomingCallSummary() },
      });
    });
    await screen.findByText("incoming");
    await userEvent.click(screen.getByRole("button", { name: "reject" }));

    await waitFor(() => {
      expect(engine.close).toHaveBeenCalled();
      expect(screen.getByTestId("call-phase")).toHaveTextContent("ended");
    });
  });

  it("shows a localized local video preview while an outgoing video call is ringing", async () => {
    const realtimeClient = createFakeRealtimeClient();
    const engine = createFakeCallEngine();
    await renderWithProviders(
      <CallProvider engine={engine}>
        <CallActionProbe conversation={directConversation} />
        <CallOverlay />
      </CallProvider>,
      { language: "zh-CN", realtimeClient },
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));

    expect(await screen.findByLabelText("本地视频预览")).toBeInTheDocument();
  });

  it("closes the engine when the provider unmounts", async () => {
    const engine = createFakeCallEngine();
    const rendered = await renderWithProviders(
      <CallProvider engine={engine}>
        <CallStateProbe />
      </CallProvider>,
    );

    expect(engine.close).not.toHaveBeenCalled();

    rendered.unmount();

    expect(engine.close).toHaveBeenCalledTimes(1);
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

function CallActionProbe({ conversation }: { conversation: ConversationSummary }) {
  const call = useCall();

  return (
    <div>
      <button onClick={() => void call.startCall(conversation, "video")} type="button">
        start
      </button>
      <button
        onClick={() => void call.acceptIncoming().catch(() => undefined)}
        type="button"
      >
        accept
      </button>
      <button
        onClick={() => void call.rejectIncoming().catch(() => undefined)}
        type="button"
      >
        reject
      </button>
      <button
        onClick={() => void call.cancelOutgoing().catch(() => undefined)}
        type="button"
      >
        cancel
      </button>
      <button onClick={() => void call.hangUp().catch(() => undefined)} type="button">
        hang up
      </button>
    </div>
  );
}

function CallStateProbe() {
  const { state } = useCall();

  return <div data-testid="call-phase">{state.phase}</div>;
}

async function renderWithProviders(
  ui: ReactElement,
  {
    apiClient = createFakeApiClient(),
    language = "en-US",
    realtimeClient = createFakeRealtimeClient(),
  }: {
    apiClient?: ApiClient;
    language?: "en-US" | "zh-CN";
    realtimeClient?: ReturnType<typeof createFakeRealtimeClient>;
  } = {},
) {
  const i18nInstance = await createAppI18n({
    language,
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

function expectMediaPrepared(
  engine: ReturnType<typeof createFakeCallEngine>,
  mediaType: "audio" | "video",
) {
  expect(
    engine.prepareLocalMedia.mock.calls.some(
      ([requestedMediaType]) => requestedMediaType === mediaType,
    ),
  ).toBe(true);
}

function createFakeCallEngine() {
  const listeners = new Set<(event: CallEngineEvent) => void>();

  return {
    prepareLocalMedia: vi.fn().mockResolvedValue(new MediaStream()),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
    acceptOffer: vi.fn().mockResolvedValue({ type: "answer", sdp: "v=0" }),
    acceptAnswer: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    toggleMuted: vi.fn().mockReturnValue(true),
    toggleCamera: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    subscribe: vi.fn((listener: (event: CallEngineEvent) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    }),
    emit(event: CallEngineEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  } satisfies CallEnginePort & { emit(event: CallEngineEvent): void };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function createFakeRealtimeClient({
  rejectCommands = [],
}: {
  rejectCommands?: string[];
} = {}) {
  const listeners = new Set<(event: RealtimeIncoming) => void>();
  const client = {
    sendCommand: vi.fn((type: string, payload?: Record<string, unknown>) => {
      void payload;

      if (rejectCommands.includes(type)) {
        return Promise.reject(new Error(`${type} failed`));
      }

      if (type === "call.invite") {
        return Promise.resolve({ call: createCallSummary({ state: "ringing" }) });
      }

      if (type === "call.accept") {
        return Promise.resolve({
          call: createIncomingCallSummary({
            state: "connecting",
            accepted_client_id: "caller-client-1",
            accepted_at: "2026-07-01T00:00:15.000Z",
          }),
        });
      }

      if (type === "call.signal") {
        return Promise.resolve({ accepted: true });
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

function getSignalTypes(realtimeClient: ReturnType<typeof createFakeRealtimeClient>) {
  return realtimeClient.sendCommand.mock.calls
    .filter(([type]) => type === "call.signal")
    .map(([, payload]) =>
      typeof payload?.signal_type === "string" ? payload.signal_type : "",
    );
}

function createCallSummary(overrides: Partial<CallSummary> = {}) {
  return {
    ...createCallSummaryShape(),
    ...overrides,
  };
}

function createIncomingCallSummary(overrides: Partial<CallSummary> = {}) {
  return createCallSummary({
    caller: remoteUser,
    callee: localUser,
    caller_client_id: "remote-client-1",
    accepted_client_id: null,
    ...overrides,
  });
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

function createFakePeerConnection() {
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
    createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "v=0" }),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    addIceCandidate: vi.fn(),
    close: vi.fn(),
    onicecandidate: null as RTCPeerConnection["onicecandidate"],
    ontrack: null as RTCPeerConnection["ontrack"],
    onconnectionstatechange: null as RTCPeerConnection["onconnectionstatechange"],
    connectionState: "new" as RTCPeerConnectionState,
  };
}

function createFakeTrack(kind: "audio" | "video") {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
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
