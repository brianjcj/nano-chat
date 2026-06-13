import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./client";
import type { UserSummary } from "./types";

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

const user: UserSummary = {
  user_id: "018f0000-0000-7000-8000-000000000001",
  username: "alice",
  display_name: "Alice",
};

function createJsonFetch(body: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { calls, fetchImpl };
}

function createClient(fetchImpl: typeof fetch, token: string | null = null) {
  return createApiClient({
    baseUrl: "https://chat.example/api/v1",
    getAccessToken: () => token,
    onUnauthorized: () => undefined,
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

  it("calls injected onUnauthorized on HTTP 401", async () => {
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
    const client = createApiClient({
      baseUrl: "https://chat.example/api/v1",
      getAccessToken: () => "expired-token",
      onUnauthorized,
      fetchImpl,
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
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
});
