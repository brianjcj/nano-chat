import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./client";
import type { UserSummary } from "./types";

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

const user: UserSummary = {
  user_id: "1001",
  username: "alice",
  display_name: "Alice",
};

function createJsonFetch(body: unknown, status = 200) {
  return createTextFetch(JSON.stringify(body), status);
}

function createTextFetch(body: string, status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { calls, fetchImpl };
}

function createClient(
  fetchImpl: typeof fetch,
  token: string | null = null,
  onUnauthorized = () => undefined,
) {
  return createApiClient({
    baseUrl: "https://chat.example/api/v1",
    getAccessToken: () => token,
    onUnauthorized,
    fetchImpl,
  });
}

function headerValue(call: FetchCall | undefined, name: string) {
  return new Headers(call?.init?.headers).get(name);
}

describe("createApiClient", () => {
  it("adds Authorization: Bearer <token> when a token exists", async () => {
    const { calls, fetchImpl } = createJsonFetch(user);
    const client = createClient(fetchImpl, "token-123");

    await client.getMe();

    expect(headerValue(calls[0], "Authorization")).toBe("Bearer token-123");
  });

  it("omits Authorization when no token exists", async () => {
    const { calls, fetchImpl } = createJsonFetch(user);
    const client = createClient(fetchImpl);

    await client.getMe();

    expect(headerValue(calls[0], "Authorization")).toBeNull();
  });

  it("parses backend error envelopes into ApiError with code and status", async () => {
    const { fetchImpl } = createJsonFetch(
      {
        error: {
          code: "invalid_credentials",
          message: "Username or password is invalid",
        },
      },
      400,
    );
    const client = createClient(fetchImpl);

    await expect(
      client.login({ username: "alice", password: "bad-password" }),
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "Username or password is invalid",
      status: 400,
    });

    await expect(
      client.login({ username: "alice", password: "bad-password" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("does not call onUnauthorized when login receives invalid_credentials 401", async () => {
    const { fetchImpl } = createJsonFetch(
      {
        error: {
          code: "invalid_credentials",
          message: "Username or password is invalid",
        },
      },
      401,
    );
    const onUnauthorized = vi.fn();
    const client = createClient(fetchImpl, null, onUnauthorized);

    await expect(
      client.login({ username: "alice", password: "bad-password" }),
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "Username or password is invalid",
      status: 401,
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("calls injected onUnauthorized when a 401 response reports invalid_token", async () => {
    const { fetchImpl } = createJsonFetch(
      {
        error: {
          code: "invalid_token",
          message: "Missing or invalid bearer token",
        },
      },
      401,
    );
    const onUnauthorized = vi.fn();
    const client = createClient(fetchImpl, "expired-token", onUnauthorized);

    await expect(client.getMe()).rejects.toMatchObject({
      code: "invalid_token",
      status: 401,
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("normalizes fetch rejections into a network ApiError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const client = createClient(fetchImpl);

    await expect(client.getMe()).rejects.toMatchObject({
      code: "network",
      message: "Network request failed. Please check your connection and try again.",
      status: 0,
    });
  });

  it("normalizes malformed successful JSON into an invalid_response ApiError", async () => {
    const { fetchImpl } = createTextFetch("{not-valid-json", 200);
    const client = createClient(fetchImpl);

    await expect(client.getMe()).rejects.toMatchObject({
      code: "invalid_response",
      message: "The server returned an invalid response. Please try again.",
      status: 200,
    });
  });

  it("serializes username lookup query parameters", async () => {
    const { calls, fetchImpl } = createJsonFetch(user);
    const client = createClient(fetchImpl, "token-123");

    await client.lookupUser("alice+demo");

    const url = new URL(calls[0]?.input.toString() ?? "");
    expect(url.pathname).toBe("/api/v1/users");
    expect(url.search).toBe("?username=alice%2Bdemo");
  });

  it("serializes message history query parameters", async () => {
    const { calls, fetchImpl } = createJsonFetch([]);
    const client = createClient(fetchImpl, "token-123");

    await client.listMessages("conversation-1", {
      after_seq: 2,
      before_seq: 10,
      limit: 50,
    });

    const url = new URL(calls[0]?.input.toString() ?? "");
    expect(url.pathname).toBe("/api/v1/conversations/conversation-1/messages");
    expect(url.searchParams.get("after_seq")).toBe("2");
    expect(url.searchParams.get("before_seq")).toBe("10");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("fetches ICE servers from the calls endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ice_servers: [{ urls: ["stun:turn.example.com:3478"] }],
          expires_at: "2026-07-01T00:10:00.000Z",
        }),
        { status: 200 },
      ),
    );
    const client = createApiClient({
      baseUrl: "/api/v1",
      getAccessToken: () => "token",
      onUnauthorized: vi.fn(),
      fetchImpl,
    });

    await expect(client.getIceServers()).resolves.toEqual({
      ice_servers: [{ urls: ["stun:turn.example.com:3478"] }],
      expires_at: "2026-07-01T00:10:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/calls/ice-servers",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
