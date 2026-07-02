import type {
  ClientCommandPayloadByType,
  ClientCommandType,
  RealtimeErrorEnvelope,
  RealtimeIncoming,
  RealtimeOutgoing,
} from "./protocol";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "draining"
  | "closed";

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (handler: () => void, timeout: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

type PendingCommand<TResult = unknown> = {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
};

export type RealtimeSession = {
  access_token: string;
};

export type RealtimeClientOptions = {
  wsUrl: string;
  WebSocketCtor?: typeof WebSocket;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  connectionTimeoutMs?: number;
  reconnectDelaysMs?: number[];
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const SOCKET_CONNECTING_READY_STATE = 0;
const SOCKET_OPEN_READY_STATE = 1;
const SOCKET_CLOSED_READY_STATE = 3;

export class RealtimeCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RealtimeCommandError";
    this.code = code;
    Object.setPrototypeOf(this, RealtimeCommandError.prototype);
  }
}

export class RealtimeClient {
  private readonly wsUrl: string;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly reconnectDelaysMs: number[];
  private readonly setTimeoutFn: SetTimeoutFn;
  private readonly clearTimeoutFn: ClearTimeoutFn;
  private readonly eventListeners = new Set<(event: RealtimeIncoming) => void>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private readonly pendingCommands = new Map<string, PendingCommand>();

  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "idle";
  private session: RealtimeSession | null = null;
  private explicitDisconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: TimerHandle | null = null;
  private connectionTimeoutTimer: TimerHandle | null = null;
  private heartbeatTimer: TimerHandle | null = null;
  private heartbeatTimeoutTimer: TimerHandle | null = null;
  private nextCommandId = 1;

  constructor(options: RealtimeClientOptions) {
    this.wsUrl = options.wsUrl;
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.connectionTimeoutMs =
      options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    this.reconnectDelaysMs =
      options.reconnectDelaysMs?.length === 0
        ? DEFAULT_RECONNECT_DELAYS_MS
        : (options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS);
    const setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => {
      return globalThis.setTimeout(handler, timeout);
    });
    const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => {
      globalThis.clearTimeout(handle);
    });
    this.setTimeoutFn = (handler, timeout) => setTimeoutFn(handler, timeout);
    this.clearTimeoutFn = (handle) => clearTimeoutFn(handle);
  }

  connect(session: RealtimeSession): void {
    this.session = session;
    this.explicitDisconnect = false;

    if (this.socket && this.socket.readyState !== SOCKET_CLOSED_READY_STATE) {
      return;
    }

    this.clearReconnectTimer();
    this.openSocket(false);
  }

  disconnect(): void {
    this.explicitDisconnect = true;
    this.session = null;
    this.clearReconnectTimer();
    this.clearConnectionTimeout();
    this.stopHeartbeat();
    this.rejectPendingCommands(new Error("Realtime client disconnected."));

    const socket = this.socket;
    this.socket = null;

    if (socket && socket.readyState !== SOCKET_CLOSED_READY_STATE) {
      socket.close();
    }

    this.setStatus("closed");
  }

  sendCommand<TType extends ClientCommandType, TResult>(
    type: TType,
    payload: ClientCommandPayloadByType[TType],
  ): Promise<TResult> {
    if (!this.isSocketOpen()) {
      return Promise.reject(new Error("Realtime client is not connected."));
    }

    const id = `req-${this.nextCommandId++}`;
    const envelope: RealtimeOutgoing<TType> = {
      id,
      type,
      payload,
    };

    return new Promise<TResult>((resolve, reject) => {
      this.pendingCommands.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      try {
        this.sendEnvelope(envelope);
      } catch (error) {
        this.pendingCommands.delete(id);
        reject(error);
      }
    });
  }

  subscribe(listener: (event: RealtimeIncoming) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  private openSocket(isReconnect: boolean): void {
    if (!this.session) {
      return;
    }

    this.setStatus(isReconnect ? "reconnecting" : "connecting");

    const socket = new this.WebSocketCtor(
      buildRealtimeWsUrl(this.wsUrl, this.session.access_token),
    );
    this.socket = socket;
    this.startConnectionTimeout(socket);

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }

      this.clearConnectionTimeout();
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.handleMessage(event.data);
    };

    socket.onclose = () => {
      this.handleSocketClosed(socket);
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (!isRealtimeIncoming(parsed)) {
      return;
    }

    if (parsed.type === "heartbeat.pong") {
      this.clearHeartbeatTimeout();
    }

    if (parsed.type === "server.draining") {
      this.setStatus("draining");
    }

    this.resolvePendingCommand(parsed);
    this.emitEvent(parsed);
  }

  private resolvePendingCommand(event: RealtimeIncoming): void {
    if (!("id" in event) || !event.id) {
      return;
    }

    const pendingCommand = this.pendingCommands.get(event.id);

    if (!pendingCommand) {
      return;
    }

    if (event.type === "error") {
      this.pendingCommands.delete(event.id);
      pendingCommand.reject(toRealtimeCommandError(event));
      return;
    }

    if (isCommandResponseType(event.type)) {
      this.pendingCommands.delete(event.id);
      pendingCommand.resolve(event.payload);
    }
  }

  private scheduleReconnect(): void {
    if (!this.session) {
      this.setStatus("closed");
      return;
    }

    this.setStatus("reconnecting");
    const delay = this.reconnectDelaysMs[
      Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
    ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, delay);
  }

  private startConnectionTimeout(socket: WebSocket): void {
    this.clearConnectionTimeout();

    if (this.connectionTimeoutMs <= 0) {
      return;
    }

    this.connectionTimeoutTimer = this.setTimeoutFn(() => {
      this.connectionTimeoutTimer = null;

      if (
        this.socket !== socket ||
        socket.readyState !== SOCKET_CONNECTING_READY_STATE
      ) {
        return;
      }

      try {
        socket.close();
      } finally {
        this.handleSocketClosed(socket);
      }
    }, this.connectionTimeoutMs);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeoutTimer) {
      this.clearTimeoutFn(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.scheduleHeartbeat();
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0 || !this.isSocketOpen()) {
      return;
    }

    this.heartbeatTimer = this.setTimeoutFn(() => {
      this.heartbeatTimer = null;

      if (this.status === "connected" && this.isSocketOpen()) {
        const socket = this.socket;

        if (!socket) {
          return;
        }

        this.sendEnvelope({
          type: "heartbeat.ping",
          payload: { client_time: new Date().toISOString() },
        });
        this.startHeartbeatTimeout(socket);
        this.scheduleHeartbeat();
      }
    }, this.heartbeatIntervalMs);
  }

  private startHeartbeatTimeout(socket: WebSocket): void {
    this.clearHeartbeatTimeout();

    if (this.heartbeatTimeoutMs <= 0) {
      return;
    }

    this.heartbeatTimeoutTimer = this.setTimeoutFn(() => {
      this.heartbeatTimeoutTimer = null;

      if (
        this.socket !== socket ||
        this.status !== "connected" ||
        socket.readyState !== SOCKET_OPEN_READY_STATE
      ) {
        return;
      }

      try {
        socket.close();
      } finally {
        this.handleSocketClosed(socket);
      }
    }, this.heartbeatTimeoutMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.clearTimeoutFn(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      this.clearTimeoutFn(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.socket = null;
    this.clearConnectionTimeout();
    this.stopHeartbeat();
    this.rejectPendingCommands(new Error("Realtime connection closed."));

    if (this.explicitDisconnect) {
      this.setStatus("closed");
      return;
    }

    this.scheduleReconnect();
  }

  private sendEnvelope(envelope: RealtimeOutgoing<ClientCommandType, unknown>): void {
    this.socket?.send(JSON.stringify(envelope));
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN_READY_STATE;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) {
      return;
    }

    this.status = status;

    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private emitEvent(event: RealtimeIncoming): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private rejectPendingCommands(reason: unknown): void {
    for (const pendingCommand of this.pendingCommands.values()) {
      pendingCommand.reject(reason);
    }

    this.pendingCommands.clear();
  }
}

export function buildRealtimeWsUrl(wsUrl: string, accessToken: string): string {
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(wsUrl);
  const url = new URL(wsUrl, "http://nano-chat.local");

  url.searchParams.set("version", "1");
  url.searchParams.set("token", accessToken);

  if (isAbsolute) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function toRealtimeCommandError(event: RealtimeErrorEnvelope) {
  return new RealtimeCommandError(event.error.code, event.error.message);
}

function isCommandResponseType(type: string) {
  return type.endsWith(".ok") || type === "heartbeat.pong";
}

function isRealtimeIncoming(value: unknown): value is RealtimeIncoming {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "error") {
    return isRecord(value.error);
  }

  return "payload" in value || value.type === "server.draining";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
