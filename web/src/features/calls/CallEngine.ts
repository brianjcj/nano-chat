export type CallEngineDeps = {
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getIceServers: () => Promise<RTCIceServer[]>;
};

export type CallEngineEvent =
  | { type: "ice_candidate"; candidate: RTCIceCandidateInit }
  | { type: "remote_stream"; stream: MediaStream }
  | { type: "connected" }
  | { type: "failed" }
  | { type: "closed" };

export type PrepareLocalMediaOptions = {
  shouldContinue?: () => boolean;
};

export class CallEngine {
  private readonly createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly getIceServers: () => Promise<RTCIceServer[]>;
  private readonly listeners = new Set<(event: CallEngineEvent) => void>();
  private readonly addedLocalTracks = new Set<MediaStreamTrack>();

  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private muted = false;
  private cameraOff = false;
  private remoteDescriptionApplied = false;
  private readonly pendingRemoteIceCandidates: RTCIceCandidateInit[] = [];

  constructor(deps: CallEngineDeps) {
    this.createPeerConnection =
      deps.createPeerConnection ??
      ((configuration) => new RTCPeerConnection(configuration));
    this.getUserMedia = deps.getUserMedia ?? getBrowserUserMedia;
    this.getIceServers = deps.getIceServers;
  }

  async prepareLocalMedia(
    mediaType: "audio" | "video",
    { shouldContinue = () => true }: PrepareLocalMediaOptions = {},
  ): Promise<MediaStream> {
    let stream: MediaStream | null = null;
    let installed = false;

    try {
      stream = await this.getUserMedia({
        audio: true,
        video: mediaType === "video",
      });

      if (!shouldContinue()) {
        throw new DOMException("Media preparation was canceled.", "AbortError");
      }

      const iceServers = this.peerConnection ? null : await this.getIceServers();

      if (!shouldContinue()) {
        throw new DOMException("Media preparation was canceled.", "AbortError");
      }

      this.localStream = stream;
      this.muted = false;
      this.cameraOff = false;

      const peerConnection =
        this.peerConnection ?? this.installPeerConnection(iceServers ?? []);
      this.addLocalTracks(peerConnection);
      installed = true;

      return stream;
    } catch (error) {
      if (stream && !installed) {
        stopMediaStream(stream);

        if (this.localStream === stream) {
          this.localStream = null;
        }
      }

      throw error;
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const peerConnection = await this.ensurePeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    return offer;
  }

  async acceptOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    const peerConnection = await this.ensurePeerConnection();
    await peerConnection.setRemoteDescription(offer);
    this.remoteDescriptionApplied = true;
    await this.flushPendingRemoteIceCandidates(peerConnection);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    return answer;
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    const peerConnection = await this.ensurePeerConnection();
    await peerConnection.setRemoteDescription(answer);
    this.remoteDescriptionApplied = true;
    await this.flushPendingRemoteIceCandidates(peerConnection);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const peerConnection = await this.ensurePeerConnection();

    if (!this.remoteDescriptionApplied) {
      this.pendingRemoteIceCandidates.push(candidate);
      return;
    }

    await peerConnection.addIceCandidate(candidate);
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;

    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted;
    }

    return this.muted;
  }

  toggleCamera(): boolean {
    this.cameraOff = !this.cameraOff;

    for (const track of this.localStream?.getVideoTracks() ?? []) {
      track.enabled = !this.cameraOff;
    }

    return this.cameraOff;
  }

  close(): void {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = null;
    this.remoteDescriptionApplied = false;
    this.pendingRemoteIceCandidates.length = 0;
    this.addedLocalTracks.clear();
    this.peerConnection?.close();
    this.peerConnection = null;
    this.emit({ type: "closed" });
  }

  subscribe(listener: (event: CallEngineEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private async ensurePeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const iceServers = await this.getIceServers();

    return this.installPeerConnection(iceServers);
  }

  private installPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
    const peerConnection = this.createPeerConnection({ iceServers });
    this.peerConnection = peerConnection;

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.emit({
        type: "ice_candidate",
        candidate: toIceCandidateInit(event.candidate),
      });
    };
    peerConnection.ontrack = (event) => {
      const [stream] = event.streams;

      if (stream) {
        this.emit({ type: "remote_stream", stream });
      }
    };
    peerConnection.onconnectionstatechange = () => {
      switch (peerConnection.connectionState) {
        case "connected":
          this.emit({ type: "connected" });
          break;
        case "failed":
          this.emit({ type: "failed" });
          break;
        case "closed":
          this.emit({ type: "closed" });
          break;
        default:
          break;
      }
    };

    this.addLocalTracks(peerConnection);

    return peerConnection;
  }

  private addLocalTracks(peerConnection: RTCPeerConnection): void {
    if (!this.localStream) {
      return;
    }

    for (const track of this.localStream.getTracks()) {
      if (this.addedLocalTracks.has(track)) {
        continue;
      }

      peerConnection.addTrack(track, this.localStream);
      this.addedLocalTracks.add(track);
    }
  }

  private async flushPendingRemoteIceCandidates(
    peerConnection: RTCPeerConnection,
  ): Promise<void> {
    const candidates = this.pendingRemoteIceCandidates.splice(0);

    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(candidate);
    }
  }

  private emit(event: CallEngineEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function getBrowserUserMedia(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(
      new DOMException("Media devices are unavailable.", "NotFoundError"),
    );
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function toIceCandidateInit(candidate: RTCIceCandidate | RTCIceCandidateInit) {
  if ("toJSON" in candidate && typeof candidate.toJSON === "function") {
    return candidate.toJSON();
  }

  return candidate;
}
