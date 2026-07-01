import { describe, expect, it, beforeEach } from "vitest";

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

  it("serializes call signaling command envelopes with snake_case payload", async () => {
    const client = createClient("wss://chat.example/ws?version=1");
    client.connect({ access_token: "token-123" });
    const socket = MockWebSocket.instances[0];
    socket?.open();

    const result = client.sendCommand("call.signal", {
      call_id: "call-1",
      signal_type: "offer",
      data: { type: "offer", sdp: "v=0" },
    });

    const sentEnvelope = JSON.parse(socket?.sent[0] ?? "{}");
    expect(sentEnvelope).toMatchObject({
      id: expect.any(String),
      type: "call.signal",
      payload: {
        call_id: "call-1",
        signal_type: "offer",
        data: { type: "offer", sdp: "v=0" },
      },
    });

    socket?.emitMessage({
      id: sentEnvelope.id,
      type: "call.signal.ok",
      payload: { accepted: true },
    });

    await expect(result).resolves.toEqual({ accepted: true });
  });
});
