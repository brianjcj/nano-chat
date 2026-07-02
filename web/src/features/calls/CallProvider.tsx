import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PropsWithChildren,
} from "react";

import { useApiClient, useSession } from "@/app/AppProviders";
import { CallEngine, type CallEngineEvent } from "./CallEngine";
import type { ConversationSummary, CallEndReason } from "@/shared/api/types";
import { useRealtimeClient } from "@/shared/realtime/RealtimeClientContext";
import type {
  CallSignalPayload,
  CallSummary,
  RealtimeIncoming,
} from "@/shared/realtime/protocol";

export type CallUiState =
  | { phase: "idle" }
  | { phase: "outgoing"; call: CallSummary; localStream: MediaStream | null }
  | { phase: "incoming"; call: CallSummary }
  | {
      phase: "connecting";
      call: CallSummary;
      localStream: MediaStream | null;
      remoteStream: MediaStream | null;
    }
  | {
      phase: "active";
      call: CallSummary;
      localStream: MediaStream | null;
      remoteStream: MediaStream | null;
      muted: boolean;
      cameraOff: boolean;
    }
  | { phase: "ended"; call: CallSummary; reason: string };

export type CallEnginePort = {
  prepareLocalMedia(mediaType: "audio" | "video"): Promise<MediaStream>;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  toggleMuted(): boolean;
  toggleCamera(): boolean;
  close(): void;
  subscribe(listener: (event: CallEngineEvent) => void): () => void;
};

type CallContextValue = {
  state: CallUiState;
  startCall(
    conversation: ConversationSummary,
    mediaType: "audio" | "video",
  ): Promise<void>;
  acceptIncoming(): Promise<void>;
  rejectIncoming(): Promise<void>;
  cancelOutgoing(): Promise<void>;
  hangUp(reason?: "completed" | "network_error"): Promise<void>;
  toggleMuted(): void;
  toggleCamera(): void;
};

type CallProviderProps = PropsWithChildren<{
  engine?: CallEnginePort;
}>;

type CallCommandResult = {
  call: CallSummary;
};

type CallOperationToken = symbol;

type PendingAcceptOperation = {
  callId: string;
  token: CallOperationToken;
};

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children, engine: injectedEngine }: CallProviderProps) {
  const apiClient = useApiClient();
  const realtimeClient = useRealtimeClient();
  const { session } = useSession();
  const engine = useMemo<CallEnginePort>(
    () =>
      injectedEngine ??
      new CallEngine({
        getIceServers: async () => (await apiClient.getIceServers()).ice_servers,
      }),
    [apiClient, injectedEngine],
  );
  const [state, setReactState] = useState<CallUiState>({ phase: "idle" });
  const stateRef = useRef<CallUiState>(state);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const connectedSentCallIdRef = useRef<string | null>(null);
  const localSignalSentCallIdRef = useRef<string | null>(null);
  const outboundIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingStartOperationRef = useRef<CallOperationToken | null>(null);
  const pendingAcceptOperationRef = useRef<PendingAcceptOperation | null>(null);

  const setState = useCallback(
    (next: CallUiState | ((current: CallUiState) => CallUiState)) => {
      setReactState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        stateRef.current = resolved;

        return resolved;
      });
    },
    [],
  );

  const closeEngine = useCallback(() => {
    engine.close();
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    mutedRef.current = false;
    cameraOffRef.current = false;
    connectedSentCallIdRef.current = null;
    localSignalSentCallIdRef.current = null;
    outboundIceCandidatesRef.current = [];
    pendingStartOperationRef.current = null;
    pendingAcceptOperationRef.current = null;
  }, [engine]);

  const startCall = useCallback<CallContextValue["startCall"]>(
    async (conversation, mediaType) => {
      if (conversation.type !== "direct" || stateRef.current.phase !== "idle") {
        return;
      }

      const operationToken = Symbol("startCall");
      pendingStartOperationRef.current = operationToken;
      let localStream: MediaStream;

      try {
        localStream = await engine.prepareLocalMedia(mediaType);
      } catch {
        if (ownsPendingStartOperation(pendingStartOperationRef, operationToken, stateRef)) {
          closeEngine();
        }
        clearPendingStartOperation(pendingStartOperationRef, operationToken);
        return;
      }

      if (!ownsPendingStartOperation(pendingStartOperationRef, operationToken, stateRef)) {
        clearPendingStartOperation(pendingStartOperationRef, operationToken);
        return;
      }

      localStreamRef.current = localStream;

      try {
        const result = await realtimeClient.sendCommand<
          "call.invite",
          CallCommandResult
        >("call.invite", {
          conversation_id: conversation.conversation_id,
          media_type: mediaType,
        });

        if (!ownsPendingStartOperation(pendingStartOperationRef, operationToken, stateRef)) {
          clearPendingStartOperation(pendingStartOperationRef, operationToken);
          return;
        }

        if (isCallCommandResult(result)) {
          setState({ phase: "outgoing", call: result.call, localStream });
        }
      } catch {
        if (ownsPendingStartOperation(pendingStartOperationRef, operationToken, stateRef)) {
          closeEngine();
        }
      } finally {
        clearPendingStartOperation(pendingStartOperationRef, operationToken);
      }
    },
    [closeEngine, engine, realtimeClient, setState],
  );

  const acceptIncoming = useCallback<CallContextValue["acceptIncoming"]>(async () => {
    const currentState = stateRef.current;

    if (currentState.phase !== "incoming") {
      return;
    }

    const { call } = currentState;
    const operationToken = Symbol("acceptIncoming");
    pendingAcceptOperationRef.current = { callId: call.call_id, token: operationToken };

    try {
      const localStream = await engine.prepareLocalMedia(call.media_type);

      if (!isCurrentIncomingCall(stateRef, call.call_id)) {
        clearPendingAcceptOperation(pendingAcceptOperationRef, operationToken);
        return;
      }

      localStreamRef.current = localStream;
      setState({
        phase: "connecting",
        call,
        localStream,
        remoteStream: remoteStreamRef.current,
      });
      const result = await realtimeClient.sendCommand<"call.accept", CallCommandResult>(
        "call.accept",
        { call_id: call.call_id },
      );

      if (
        !ownsPendingAcceptOperation(
          pendingAcceptOperationRef,
          operationToken,
          call.call_id,
        ) ||
        !isCurrentPendingAcceptState(stateRef, call.call_id)
      ) {
        clearPendingAcceptOperation(pendingAcceptOperationRef, operationToken);
        return;
      }

      if (isCallCommandResult(result) && result.call.call_id === call.call_id) {
        setState({
          phase: "connecting",
          call: result.call,
          localStream,
          remoteStream: remoteStreamRef.current,
        });
      }
    } catch {
      if (
        ownsPendingAcceptOperation(
          pendingAcceptOperationRef,
          operationToken,
          call.call_id,
        ) &&
        isCurrentPendingAcceptState(stateRef, call.call_id)
      ) {
        closeEngine();
        setState({ phase: "incoming", call });
      }
    } finally {
      clearPendingAcceptOperation(pendingAcceptOperationRef, operationToken);
    }
  }, [closeEngine, engine, realtimeClient, setState]);

  const rejectIncoming = useCallback<CallContextValue["rejectIncoming"]>(async () => {
    const currentState = stateRef.current;

    if (currentState.phase !== "incoming") {
      return;
    }

    const { call } = currentState;

    try {
      await realtimeClient.sendCommand<"call.reject", CallCommandResult>(
        "call.reject",
        { call_id: call.call_id },
      );
    } catch {
      // Local cleanup must still happen if the realtime command cannot be sent.
    } finally {
      closeEngine();
      setState({ phase: "ended", call: withEndedCallState(call), reason: "rejected" });
    }
  }, [closeEngine, realtimeClient, setState]);

  const cancelOutgoing = useCallback<CallContextValue["cancelOutgoing"]>(async () => {
    const currentState = stateRef.current;

    if (currentState.phase !== "outgoing") {
      return;
    }

    const { call } = currentState;

    try {
      await realtimeClient.sendCommand<"call.cancel", CallCommandResult>(
        "call.cancel",
        { call_id: call.call_id },
      );
    } catch {
      // Local cleanup must still happen if the realtime command cannot be sent.
    } finally {
      closeEngine();
      setState({ phase: "ended", call: withEndedCallState(call), reason: "canceled" });
    }
  }, [closeEngine, realtimeClient, setState]);

  const hangUp = useCallback<CallContextValue["hangUp"]>(
    async (reason = "completed") => {
      const currentCall = getStateCall(stateRef.current);

      if (!currentCall) {
        return;
      }

      try {
        await realtimeClient.sendCommand<"call.hangup", CallCommandResult>(
          "call.hangup",
          {
            call_id: currentCall.call_id,
            reason,
          },
        );
      } catch {
        // Local cleanup must still happen if the realtime command cannot be sent.
      } finally {
        closeEngine();
        setState({
          phase: "ended",
          call: withEndedCallState(currentCall, reason),
          reason,
        });
      }
    },
    [closeEngine, realtimeClient, setState],
  );

  const toggleMuted = useCallback(() => {
    const muted = engine.toggleMuted();
    mutedRef.current = muted;
    setState((currentState) =>
      currentState.phase === "active" ? { ...currentState, muted } : currentState,
    );
  }, [engine, setState]);

  const toggleCamera = useCallback(() => {
    const cameraOff = engine.toggleCamera();
    cameraOffRef.current = cameraOff;
    setState((currentState) =>
      currentState.phase === "active"
        ? { ...currentState, cameraOff }
        : currentState,
    );
  }, [engine, setState]);

  useEffect(() => {
    if (state.phase !== "ended") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setState({ phase: "idle" });
    }, 2_500);

    return () => window.clearTimeout(timeoutId);
  }, [setState, state]);

  useEffect(() => () => closeEngine(), [closeEngine]);

  useEffect(() => {
    const unsubscribe = engine.subscribe((event) => {
      const currentState = stateRef.current;

      if (currentState.phase === "ended") {
        return;
      }

      const currentCall = getStateCall(currentState);

      if (!currentCall) {
        return;
      }

      switch (event.type) {
        case "ice_candidate":
          sendOrQueueIceCandidate({
            candidate: event.candidate,
            callId: currentCall.call_id,
            localSignalSentCallIdRef,
            outboundIceCandidatesRef,
            realtimeClient,
          });
          break;
        case "remote_stream":
          remoteStreamRef.current = event.stream;
          setState((currentState) =>
            currentState.phase === "connecting" || currentState.phase === "active"
              ? { ...currentState, remoteStream: event.stream }
              : currentState,
          );
          break;
        case "connected":
          clearPendingAcceptForCall(pendingAcceptOperationRef, currentCall.call_id);
          if (connectedSentCallIdRef.current !== currentCall.call_id) {
            connectedSentCallIdRef.current = currentCall.call_id;
            void realtimeClient.sendCommand<"call.connected", unknown>(
              "call.connected",
              { call_id: currentCall.call_id },
            );
          }
          setState({
            phase: "active",
            call: { ...currentCall, state: "active" },
            localStream: localStreamRef.current,
            remoteStream: remoteStreamRef.current,
            muted: mutedRef.current,
            cameraOff: cameraOffRef.current,
          });
          break;
        case "failed":
          void realtimeClient.sendCommand<"call.hangup", unknown>("call.hangup", {
            call_id: currentCall.call_id,
            reason: "network_error",
          });
          closeEngine();
          setState({
            phase: "ended",
            call: withEndedCallState(currentCall, "network_error"),
            reason: "network_error",
          });
          break;
        case "closed":
          break;
      }
    });

    return unsubscribe;
  }, [closeEngine, engine, realtimeClient, setState]);

  useEffect(() => {
    const unsubscribe = realtimeClient.subscribe((event) => {
      void handleRealtimeEvent({
        event,
        engine,
        realtimeClient,
        sessionClientId: session?.client_id ?? null,
        setState,
        stateRef,
        localStreamRef,
        remoteStreamRef,
        mutedRef,
        cameraOffRef,
        localSignalSentCallIdRef,
        outboundIceCandidatesRef,
        pendingAcceptOperationRef,
        closeEngine,
      });
    });

    return unsubscribe;
  }, [closeEngine, engine, realtimeClient, session?.client_id, setState]);

  const value = useMemo<CallContextValue>(
    () => ({
      state,
      startCall,
      acceptIncoming,
      rejectIncoming,
      cancelOutgoing,
      hangUp,
      toggleMuted,
      toggleCamera,
    }),
    [
      acceptIncoming,
      cancelOutgoing,
      hangUp,
      rejectIncoming,
      startCall,
      state,
      toggleCamera,
      toggleMuted,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);

  if (!context) {
    throw new Error("useCall must be used inside CallProvider.");
  }

  return context;
}

export function useOptionalCall(): CallContextValue | null {
  return useContext(CallContext);
}

type HandleRealtimeEventOptions = {
  event: RealtimeIncoming;
  engine: CallEnginePort;
  realtimeClient: ReturnType<typeof useRealtimeClient>;
  sessionClientId: string | null;
  setState: (next: CallUiState | ((current: CallUiState) => CallUiState)) => void;
  stateRef: MutableRefObject<CallUiState>;
  localStreamRef: MutableRefObject<MediaStream | null>;
  remoteStreamRef: MutableRefObject<MediaStream | null>;
  mutedRef: MutableRefObject<boolean>;
  cameraOffRef: MutableRefObject<boolean>;
  localSignalSentCallIdRef: MutableRefObject<string | null>;
  outboundIceCandidatesRef: MutableRefObject<RTCIceCandidateInit[]>;
  pendingAcceptOperationRef: MutableRefObject<PendingAcceptOperation | null>;
  closeEngine: () => void;
};

async function handleRealtimeEvent({
  event,
  engine,
  realtimeClient,
  sessionClientId,
  setState,
  stateRef,
  localStreamRef,
  remoteStreamRef,
  mutedRef,
  cameraOffRef,
  localSignalSentCallIdRef,
  outboundIceCandidatesRef,
  pendingAcceptOperationRef,
  closeEngine,
}: HandleRealtimeEventOptions) {
  if (stateRef.current.phase === "ended") {
    if (isTerminalCallStateEvent(event) && isSameCurrentCall(stateRef.current, event.payload.call)) {
      closeEngine();
      setState({
        phase: "ended",
        call: event.payload.call,
        reason: event.payload.call.end_reason ?? reasonFromEventType(event.type),
      });
    }

    return;
  }

  switch (event.type) {
    case "call.incoming":
      if (stateRef.current.phase === "idle") {
        setState({ phase: "incoming", call: event.payload.call });
      }
      return;
    case "call.ringing":
      if (isSameCurrentCall(stateRef.current, event.payload.call)) {
        setState({
          phase: "outgoing",
          call: event.payload.call,
          localStream: localStreamRef.current,
        });
      }
      return;
    case "call.accepted":
      await handleAcceptedEvent({
        call: event.payload.call,
        engine,
        realtimeClient,
        sessionClientId,
        setState,
        stateRef,
        localStreamRef,
        remoteStreamRef,
        mutedRef,
        cameraOffRef,
        localSignalSentCallIdRef,
        outboundIceCandidatesRef,
        pendingAcceptOperationRef,
        closeEngine,
      });
      return;
    case "call.connected":
      if (isSameCurrentCall(stateRef.current, event.payload.call)) {
        clearPendingAcceptForCall(pendingAcceptOperationRef, event.payload.call.call_id);
        setState({
          phase: "active",
          call: event.payload.call,
          localStream: localStreamRef.current,
          remoteStream: remoteStreamRef.current,
          muted: mutedRef.current,
          cameraOff: cameraOffRef.current,
        });
      }
      return;
    case "call.rejected":
    case "call.canceled":
    case "call.ended":
    case "call.busy":
      if (isSameCurrentCall(stateRef.current, event.payload.call)) {
        closeEngine();
        setState({
          phase: "ended",
          call: event.payload.call,
          reason: event.payload.call.end_reason ?? reasonFromEventType(event.type),
        });
      }
      return;
    case "call.signal":
      await handleSignalEvent({
        payload: event.payload,
        engine,
        realtimeClient,
        stateRef,
        localStreamRef,
        remoteStreamRef,
        localSignalSentCallIdRef,
        outboundIceCandidatesRef,
        pendingAcceptOperationRef,
        setState,
        closeEngine,
      });
      return;
    default:
      return;
  }
}

type AcceptedEventOptions = Omit<HandleRealtimeEventOptions, "event"> & {
  call: CallSummary;
};

async function handleAcceptedEvent({
  call,
  engine,
  realtimeClient,
  sessionClientId,
  setState,
  stateRef,
  localStreamRef,
  remoteStreamRef,
  mutedRef,
  cameraOffRef,
  localSignalSentCallIdRef,
  outboundIceCandidatesRef,
  pendingAcceptOperationRef,
  closeEngine,
}: AcceptedEventOptions) {
  const currentState = stateRef.current;

  if (!isSameCurrentCall(currentState, call)) {
    return;
  }

  clearPendingAcceptForCall(pendingAcceptOperationRef, call.call_id);

  if (
    currentState.phase === "incoming" &&
    call.accepted_client_id &&
    call.accepted_client_id !== sessionClientId
  ) {
    closeEngine();
    setState({ phase: "ended", call, reason: "answered_elsewhere" });
    return;
  }

  if (call.caller_client_id === sessionClientId) {
    setState({
      phase: "connecting",
      call,
      localStream: localStreamRef.current,
      remoteStream: remoteStreamRef.current,
    });

    let offer: RTCSessionDescriptionInit;

    try {
      offer = await engine.createOffer();
    } catch {
      endCurrentCallWithSignalError({
        callId: call.call_id,
        closeEngine,
        setState,
        stateRef,
      });
      return;
    }

    if (!isCurrentNonEndedCall(stateRef, call.call_id)) {
      return;
    }

    try {
      await sendLocalDescriptionSignal({
        callId: call.call_id,
        data: offer,
        localSignalSentCallIdRef,
        outboundIceCandidatesRef,
        realtimeClient,
        signalType: "offer",
        shouldContinue: () => isCurrentNonEndedCall(stateRef, call.call_id),
      });
    } catch {
      endCurrentCallWithSignalError({
        callId: call.call_id,
        closeEngine,
        setState,
        stateRef,
      });
    }
    return;
  }

  if (call.state === "active") {
    setState({
      phase: "active",
      call,
      localStream: localStreamRef.current,
      remoteStream: remoteStreamRef.current,
      muted: mutedRef.current,
      cameraOff: cameraOffRef.current,
    });
    return;
  }

  setState({
    phase: "connecting",
    call,
    localStream: localStreamRef.current,
    remoteStream: remoteStreamRef.current,
  });
}

type SignalEventOptions = {
  payload: CallSignalPayload;
  engine: CallEnginePort;
  realtimeClient: ReturnType<typeof useRealtimeClient>;
  stateRef: MutableRefObject<CallUiState>;
  localStreamRef: MutableRefObject<MediaStream | null>;
  remoteStreamRef: MutableRefObject<MediaStream | null>;
  localSignalSentCallIdRef: MutableRefObject<string | null>;
  outboundIceCandidatesRef: MutableRefObject<RTCIceCandidateInit[]>;
  pendingAcceptOperationRef: MutableRefObject<PendingAcceptOperation | null>;
  setState: (next: CallUiState | ((current: CallUiState) => CallUiState)) => void;
  closeEngine: () => void;
};

async function handleSignalEvent({
  payload,
  engine,
  realtimeClient,
  stateRef,
  localStreamRef,
  remoteStreamRef,
  localSignalSentCallIdRef,
  outboundIceCandidatesRef,
  pendingAcceptOperationRef,
  setState,
  closeEngine,
}: SignalEventOptions) {
  const currentCall = getCurrentNonEndedCall(stateRef, payload.call_id);

  if (!currentCall) {
    return;
  }

  if (payload.signal_type === "offer") {
    clearPendingAcceptForCall(pendingAcceptOperationRef, payload.call_id);
    let answer: RTCSessionDescriptionInit;

    try {
      answer = await engine.acceptOffer(payload.data as RTCSessionDescriptionInit);
    } catch {
      endCurrentCallWithSignalError({
        callId: payload.call_id,
        closeEngine,
        setState,
        stateRef,
      });
      return;
    }

    const latestCall = getCurrentNonEndedCall(stateRef, payload.call_id);

    if (!latestCall) {
      return;
    }

    setState({
      phase: "connecting",
      call: { ...latestCall, state: "connecting" },
      localStream: localStreamRef.current,
      remoteStream: remoteStreamRef.current,
    });

    try {
      await sendLocalDescriptionSignal({
        callId: payload.call_id,
        data: answer,
        localSignalSentCallIdRef,
        outboundIceCandidatesRef,
        realtimeClient,
        signalType: "answer",
        shouldContinue: () => isCurrentNonEndedCall(stateRef, payload.call_id),
      });
    } catch {
      endCurrentCallWithSignalError({
        callId: payload.call_id,
        closeEngine,
        setState,
        stateRef,
      });
    }
    return;
  }

  if (payload.signal_type === "answer") {
    try {
      await engine.acceptAnswer(payload.data as RTCSessionDescriptionInit);
    } catch {
      endCurrentCallWithSignalError({
        callId: payload.call_id,
        closeEngine,
        setState,
        stateRef,
      });
    }
    return;
  }

  await engine.addIceCandidate(payload.data as RTCIceCandidateInit);
}

type TerminalCallStateEvent = {
  type: "call.rejected" | "call.canceled" | "call.ended" | "call.busy";
  payload: { call: CallSummary };
};

function isTerminalCallStateEvent(
  event: RealtimeIncoming,
): event is TerminalCallStateEvent {
  return (
    event.type === "call.rejected" ||
    event.type === "call.canceled" ||
    event.type === "call.ended" ||
    event.type === "call.busy"
  );
}

function sendOrQueueIceCandidate({
  candidate,
  callId,
  localSignalSentCallIdRef,
  outboundIceCandidatesRef,
  realtimeClient,
}: {
  candidate: RTCIceCandidateInit;
  callId: string;
  localSignalSentCallIdRef: MutableRefObject<string | null>;
  outboundIceCandidatesRef: MutableRefObject<RTCIceCandidateInit[]>;
  realtimeClient: ReturnType<typeof useRealtimeClient>;
}) {
  if (localSignalSentCallIdRef.current === callId) {
    void sendIceCandidate({ candidate, callId, realtimeClient }).catch(() => undefined);
    return;
  }

  outboundIceCandidatesRef.current.push(candidate);
}

async function sendLocalDescriptionSignal({
  callId,
  data,
  localSignalSentCallIdRef,
  outboundIceCandidatesRef,
  realtimeClient,
  signalType,
  shouldContinue = () => true,
}: {
  callId: string;
  data: RTCSessionDescriptionInit;
  localSignalSentCallIdRef: MutableRefObject<string | null>;
  outboundIceCandidatesRef: MutableRefObject<RTCIceCandidateInit[]>;
  realtimeClient: ReturnType<typeof useRealtimeClient>;
  signalType: "offer" | "answer";
  shouldContinue?: () => boolean;
}): Promise<boolean> {
  if (!shouldContinue()) {
    return false;
  }

  await realtimeClient.sendCommand<"call.signal", unknown>("call.signal", {
    call_id: callId,
    signal_type: signalType,
    data,
  });

  if (!shouldContinue()) {
    return false;
  }

  localSignalSentCallIdRef.current = callId;

  const queuedCandidates = outboundIceCandidatesRef.current;
  outboundIceCandidatesRef.current = [];

  for (const candidate of queuedCandidates) {
    if (!shouldContinue()) {
      return false;
    }

    await sendIceCandidate({ candidate, callId, realtimeClient }).catch(() => undefined);
  }

  return true;
}

function sendIceCandidate({
  candidate,
  callId,
  realtimeClient,
}: {
  candidate: RTCIceCandidateInit;
  callId: string;
  realtimeClient: ReturnType<typeof useRealtimeClient>;
}) {
  return realtimeClient.sendCommand<"call.signal", unknown>("call.signal", {
    call_id: callId,
    signal_type: "ice_candidate",
    data: candidate,
  });
}

function getStateCall(state: CallUiState): CallSummary | null {
  return state.phase === "idle" ? null : state.call;
}

function isSameCurrentCall(state: CallUiState, call: CallSummary): boolean {
  const currentCall = getStateCall(state);

  return Boolean(currentCall && currentCall.call_id === call.call_id);
}

function getCurrentNonEndedCall(
  stateRef: MutableRefObject<CallUiState>,
  callId: string,
): CallSummary | null {
  const currentState = stateRef.current;

  if (currentState.phase === "idle" || currentState.phase === "ended") {
    return null;
  }

  const currentCall = getStateCall(currentState);

  return currentCall?.call_id === callId ? currentCall : null;
}

function isCurrentNonEndedCall(
  stateRef: MutableRefObject<CallUiState>,
  callId: string,
): boolean {
  return getCurrentNonEndedCall(stateRef, callId) !== null;
}

function isCurrentIncomingCall(
  stateRef: MutableRefObject<CallUiState>,
  callId: string,
): boolean {
  const currentState = stateRef.current;

  return currentState.phase === "incoming" && currentState.call.call_id === callId;
}

function ownsPendingStartOperation(
  pendingStartOperationRef: MutableRefObject<CallOperationToken | null>,
  operationToken: CallOperationToken,
  stateRef: MutableRefObject<CallUiState>,
): boolean {
  return pendingStartOperationRef.current === operationToken && stateRef.current.phase === "idle";
}

function clearPendingStartOperation(
  pendingStartOperationRef: MutableRefObject<CallOperationToken | null>,
  operationToken: CallOperationToken,
): void {
  if (pendingStartOperationRef.current === operationToken) {
    pendingStartOperationRef.current = null;
  }
}

function ownsPendingAcceptOperation(
  pendingAcceptOperationRef: MutableRefObject<PendingAcceptOperation | null>,
  operationToken: CallOperationToken,
  callId: string,
): boolean {
  const operation = pendingAcceptOperationRef.current;

  return operation?.token === operationToken && operation.callId === callId;
}

function clearPendingAcceptOperation(
  pendingAcceptOperationRef: MutableRefObject<PendingAcceptOperation | null>,
  operationToken: CallOperationToken,
): void {
  if (pendingAcceptOperationRef.current?.token === operationToken) {
    pendingAcceptOperationRef.current = null;
  }
}

function clearPendingAcceptForCall(
  pendingAcceptOperationRef: MutableRefObject<PendingAcceptOperation | null>,
  callId: string,
): void {
  if (pendingAcceptOperationRef.current?.callId === callId) {
    pendingAcceptOperationRef.current = null;
  }
}

function isCurrentPendingAcceptState(
  stateRef: MutableRefObject<CallUiState>,
  callId: string,
): boolean {
  const currentState = stateRef.current;

  return currentState.phase === "connecting" && currentState.call.call_id === callId;
}

function endCurrentCallWithSignalError({
  callId,
  closeEngine,
  setState,
  stateRef,
}: {
  callId: string;
  closeEngine: () => void;
  setState: (next: CallUiState | ((current: CallUiState) => CallUiState)) => void;
  stateRef: MutableRefObject<CallUiState>;
}) {
  const currentCall = getCurrentNonEndedCall(stateRef, callId);

  if (!currentCall) {
    return;
  }

  closeEngine();
  setState({
    phase: "ended",
    call: withEndedCallState(currentCall, "network_error"),
    reason: "network_error",
  });
}

function withEndedCallState(
  call: CallSummary,
  reason: CallEndReason | null = call.end_reason,
): CallSummary {
  return {
    ...call,
    state: "ended",
    ended_at: call.ended_at ?? new Date().toISOString(),
    end_reason: reason,
  };
}

function reasonFromEventType(type: string) {
  switch (type) {
    case "call.rejected":
      return "rejected";
    case "call.canceled":
      return "canceled";
    case "call.busy":
      return "busy";
    default:
      return "completed";
  }
}

function isCallCommandResult(value: unknown): value is CallCommandResult {
  return isRecord(value) && isRecord(value.call) && typeof value.call.call_id === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
