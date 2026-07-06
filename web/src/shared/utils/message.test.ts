import { describe, expect, it } from "vitest";

import {
  formatConversationListTime,
  formatMessageSentTime,
  mergeMessagesBySeq,
  utf8ByteLength,
  validateMessageBody,
  type ChatMessage,
} from "./message";
import type { UserSummary } from "@/shared/api/types";

const sender: UserSummary = {
  user_id: "1001",
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
    message_type: "text",
    metadata: {},
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

  it("formats today's message time as hours and minutes", () => {
    expect(
      formatMessageSentTime(
        "2026-07-06T14:05:00",
        new Date("2026-07-06T23:00:00"),
      ),
    ).toBe("14:05");
  });

  it("formats older message time with month, day, hours, and minutes", () => {
    expect(
      formatMessageSentTime(
        "2026-07-05T09:08:00",
        new Date("2026-07-06T23:00:00"),
      ),
    ).toBe("07-05 09:08");
  });

  it("formats conversation list time for today", () => {
    expect(
      formatConversationListTime(
        "2026-07-06T14:05:00",
        "zh-CN",
        new Date("2026-07-06T23:00:00"),
      ),
    ).toBe("14:05");
  });

  it("formats conversation list time with localized weekdays in the current week", () => {
    const now = new Date("2026-07-08T12:00:00");

    expect(formatConversationListTime("2026-07-06T09:00:00", "zh-CN", now)).toBe(
      "星期一",
    );
    expect(formatConversationListTime("2026-07-06T09:00:00", "en-US", now)).toBe(
      "Monday",
    );
  });

  it("formats conversation list time with month and day in the current year", () => {
    expect(
      formatConversationListTime(
        "2026-06-30T09:00:00",
        "zh-CN",
        new Date("2026-07-08T12:00:00"),
      ),
    ).toBe("06/30");
  });

  it("formats conversation list time with two-digit year outside the current year", () => {
    expect(
      formatConversationListTime(
        "2025-12-31T09:00:00",
        "zh-CN",
        new Date("2026-07-08T12:00:00"),
      ),
    ).toBe("25/12/31");
  });

  it("merges messages by seq while preserving ascending order", () => {
    expect(mergeMessagesBySeq([message(2)], [message(1), message(2, "new")])).toEqual([
      message(1),
      message(2, "new"),
    ]);
  });
});
