import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeClient, type RealtimeStatus } from "./realtimeClient";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  emitMessage(envelope: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(envelope) }),
    );
  }
}

function createClient(wsUrl: string) {
  return new RealtimeClient({
    wsUrl,
    WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
    heartbeatIntervalMs: 0,
  });
}

describe("RealtimeClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds /ws?version=1&token=<token> when connecting to a configured ws base", () => {
    const client = createClient("/ws");

    client.connect({ access_token: "token-123" });

    expect(MockWebSocket.instances[0]?.url).toBe(
      "/ws?version=1&token=token-123",
    );
  });

  it("serializes sendCommand envelopes with id, type, and snake_case payload", async () => {
    const client = createClient("wss://chat.example/ws?version=1");
    client.connect({ access_token: "token-123" });
    const socket = MockWebSocket.instances[0];
    socket?.open();

    const result = client.sendCommand("message.send", {
      conversation_id: "conversation-1",
      client_msg_id: "client-message-1",
      body: "hello",
    });

    const sentEnvelope = JSON.parse(socket?.sent[0] ?? "{}");
    expect(sentEnvelope).toMatchObject({
      id: expect.any(String),
      type: "message.send",
      payload: {
        conversation_id: "conversation-1",
        client_msg_id: "client-message-1",
        body: "hello",
      },
    });

    socket?.emitMessage({
      id: sentEnvelope.id,
      type: "message.send.ok",
      payload: { accepted: true },
    });

    await expect(result).resolves.toEqual({ accepted: true });
  });

  it("updates connection status to draining when server.draining is received", () => {
    const client = createClient("/ws");
    const observedStatuses: RealtimeStatus[] = [];
    client.subscribeStatus((status) => observedStatuses.push(status));

    client.connect({ access_token: "token-123" });
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.emitMessage({ type: "server.draining", payload: {} });

    expect(client.getStatus()).toBe("draining");
    expect(observedStatuses).toContain("draining");
  });

  it("reconnects after a connected socket misses a heartbeat pong", async () => {
    vi.useFakeTimers();
    const client = new RealtimeClient({
      wsUrl: "/ws",
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 50,
      reconnectDelaysMs: [0],
    });

    client.connect({ access_token: "token-123" });
    const firstSocket = MockWebSocket.instances[0];
    firstSocket?.open();

    await vi.advanceTimersByTimeAsync(100);

    expect(firstSocket?.sent.map((data) => JSON.parse(data))).toEqual([
      expect.objectContaining({ type: "heartbeat.ping" }),
    ]);

    await vi.advanceTimersByTimeAsync(50);
    await vi.runOnlyPendingTimersAsync();

    expect(firstSocket?.readyState).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(client.getStatus()).toBe("reconnecting");

    MockWebSocket.instances[1]?.open();

    expect(client.getStatus()).toBe("connected");
  });

  it("abandons a reconnect attempt that stays stuck connecting and tries again", async () => {
    vi.useFakeTimers();
    const client = new RealtimeClient({
      wsUrl: "/ws",
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
      connectionTimeoutMs: 100,
      heartbeatIntervalMs: 0,
      reconnectDelaysMs: [0],
    });

    client.connect({ access_token: "token-123" });
    const firstSocket = MockWebSocket.instances[0];
    firstSocket?.open();
    firstSocket?.close();
    await vi.runOnlyPendingTimersAsync();

    const stuckReconnectSocket = MockWebSocket.instances[1];
    expect(stuckReconnectSocket?.readyState).toBe(0);
    expect(client.getStatus()).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();

    expect(stuckReconnectSocket?.readyState).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(client.getStatus()).toBe("reconnecting");

    MockWebSocket.instances[2]?.open();

    expect(client.getStatus()).toBe("connected");
  });

  it("calls timer functions without rebinding them to the realtime client", () => {
    let wasCalledWithThis = false;
    const setTimeoutFn = function (
      this: unknown,
      _handler: () => void,
      _timeout: number,
    ) {
      void _handler;
      void _timeout;
      wasCalledWithThis = this !== undefined;
      return 1 as ReturnType<typeof setTimeout>;
    };
    const client = new RealtimeClient({
      wsUrl: "/ws",
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
      connectionTimeoutMs: 100,
      heartbeatIntervalMs: 0,
      setTimeoutFn,
    });

    client.connect({ access_token: "token-123" });

    expect(wasCalledWithThis).toBe(false);
  });
});
