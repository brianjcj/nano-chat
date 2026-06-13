import { describe, expect, it } from "vitest";

import {
  mergeMessagesBySeq,
  utf8ByteLength,
  validateMessageBody,
  type ChatMessage,
} from "./message";
import type { UserSummary } from "@/shared/api/types";

const sender: UserSummary = {
  user_id: "user-1",
  username: "alice",
  display_name: "Alice",
};

function message(seq: number, body = `message-${seq}`): ChatMessage {
  return {
    message_id: `message-${seq}`,
    conversation_id: "conversation-1",
    message_seq: seq,
    sender,
    body,
    created_at: `2026-06-14T00:00:0${seq}.000Z`,
  };
}

describe("message helpers", () => {
  it("counts UTF-8 bytes for emoji", () => {
    expect(utf8ByteLength("😀")).toBe(4);
  });

  it("rejects empty and whitespace-only bodies", () => {
    expect(validateMessageBody("")).toEqual({ ok: false, code: "empty_message" });
    expect(validateMessageBody("  \n\t  ")).toEqual({
      ok: false,
      code: "empty_message",
    });
  });

  it("rejects bodies over the UTF-8 byte limit", () => {
    expect(validateMessageBody("a".repeat(4097))).toEqual({
      ok: false,
      code: "message_too_large",
    });
  });

  it("merges messages by seq while preserving ascending order", () => {
    expect(mergeMessagesBySeq([message(2)], [message(1), message(2, "new")])).toEqual([
      message(1),
      message(2, "new"),
    ]);
  });
});
