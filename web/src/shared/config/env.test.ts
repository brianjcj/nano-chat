import { describe, expect, it } from "vitest";

import { getAppEnv } from "./env";

describe("getAppEnv", () => {
  it("defaults apiBaseUrl to /api/v1", () => {
    expect(getAppEnv({}, { protocol: "https:", host: "chat.example" }).apiBaseUrl).toBe(
      "/api/v1",
    );
  });

  it("derives a wss WebSocket URL from an https current origin", () => {
    expect(getAppEnv({}, { protocol: "https:", host: "chat.example" }).wsUrl).toBe(
      "wss://chat.example/ws?version=1",
    );
  });

  it("derives a ws WebSocket URL from an http current origin", () => {
    expect(getAppEnv({}, { protocol: "http:", host: "localhost:5173" }).wsUrl).toBe(
      "ws://localhost:5173/ws?version=1",
    );
  });

  it("uses explicit VITE_API_BASE_URL and VITE_WS_URL overrides", () => {
    expect(
      getAppEnv(
        {
          VITE_API_BASE_URL: "https://api.nano.test/api/v1",
          VITE_WS_URL: "wss://ws.nano.test/ws?version=1",
        },
        { protocol: "https:", host: "chat.example" },
      ),
    ).toEqual({
      apiBaseUrl: "https://api.nano.test/api/v1",
      wsUrl: "wss://ws.nano.test/ws?version=1",
    });
  });
});
