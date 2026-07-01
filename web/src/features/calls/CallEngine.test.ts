import { beforeAll, describe, expect, it, vi } from "vitest";
import { CallEngine } from "./CallEngine";

beforeAll(() => {
  if (!("MediaStream" in globalThis)) {
    vi.stubGlobal("MediaStream", TestMediaStream);
  }
});

it("starts local media before creating an offer", async () => {
  const localStream = new MediaStream();
  const getUserMedia = vi.fn().mockResolvedValue(localStream);
  const peer = createFakePeerConnection();
  const engine = new CallEngine({
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    getUserMedia,
    getIceServers: vi.fn().mockResolvedValue([{ urls: ["stun:turn.example.com:3478"] }]),
  });

  await engine.prepareLocalMedia("video");
  const offer = await engine.createOffer();

  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
  expect(peer.addTrack).toHaveBeenCalled();
  expect(offer.type).toBe("offer");
});

it("toggles audio tracks and stops media on close", async () => {
  const localStream = new MediaStream();
  const audioTrack = createFakeTrack("audio");
  localStream.addTrack(audioTrack);
  const peer = createFakePeerConnection();
  const engine = new CallEngine({
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    getUserMedia: vi.fn().mockResolvedValue(localStream),
    getIceServers: vi.fn().mockResolvedValue([]),
  });

  await engine.prepareLocalMedia("audio");

  expect(engine.toggleMuted()).toBe(true);
  expect(audioTrack.enabled).toBe(false);
  expect(engine.toggleMuted()).toBe(false);
  expect(audioTrack.enabled).toBe(true);

  engine.close();

  expect(audioTrack.stop).toHaveBeenCalled();
  expect(peer.close).toHaveBeenCalled();
});

describe("signaling", () => {
  it("emits ICE candidates from the peer connection", async () => {
    const peer = createFakePeerConnection();
    const engine = new CallEngine({
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
      getIceServers: vi.fn().mockResolvedValue([]),
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    await engine.prepareLocalMedia("audio");
    peer.onicecandidate?.call(
      peer as unknown as RTCPeerConnection,
      { candidate: { candidate: "candidate:0" } } as RTCPeerConnectionIceEvent,
    );

    expect(listener).toHaveBeenCalledWith({
      type: "ice_candidate",
      candidate: { candidate: "candidate:0" },
    });
  });

  it("buffers inbound ICE candidates until the remote description is applied", async () => {
    const peer = createFakePeerConnection();
    const engine = new CallEngine({
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
      getIceServers: vi.fn().mockResolvedValue([]),
    });
    const earlyCandidate = { candidate: "candidate:early" };
    const offer = { type: "offer", sdp: "v=0" } satisfies RTCSessionDescriptionInit;

    await engine.addIceCandidate(earlyCandidate);

    expect(peer.addIceCandidate).not.toHaveBeenCalled();

    await engine.acceptOffer(offer);

    expect(peer.setRemoteDescription).toHaveBeenCalledWith(offer);
    expect(peer.addIceCandidate).toHaveBeenCalledWith(earlyCandidate);
  });

  it("treats disconnected as transient and only emits failed for failed state", async () => {
    const peer = createFakePeerConnection();
    const engine = new CallEngine({
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
      getIceServers: vi.fn().mockResolvedValue([]),
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    await engine.prepareLocalMedia("audio");
    peer.connectionState = "disconnected";
    peer.onconnectionstatechange?.call(
      peer as unknown as RTCPeerConnection,
      new Event("connectionstatechange"),
    );

    expect(listener).not.toHaveBeenCalledWith({ type: "failed" });

    peer.connectionState = "failed";
    peer.onconnectionstatechange?.call(
      peer as unknown as RTCPeerConnection,
      new Event("connectionstatechange"),
    );

    expect(listener).toHaveBeenCalledWith({ type: "failed" });
  });
});

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

  constructor(tracks: MediaStreamTrack[] = [createFakeTrack("audio")]) {
    this.tracks.push(...tracks);
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
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
