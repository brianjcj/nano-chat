import { beforeEach, describe, expect, it } from "vitest";

import { useImStore } from "./imStore";

const SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY =
  "nano-chat:show-message-sequence-numbers";

describe("IM store feature area", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useImStore.getState().reset();
  });

  it("starts with IM as the current feature area", () => {
    expect(useImStore.getState().currentFeatureArea).toBe("im");
  });

  it("sets the current feature area to IM without breaking reset behavior", () => {
    useImStore.getState().setCurrentConversationId("conversation-1");
    useImStore.getState().setCurrentFeatureArea("im");

    expect(useImStore.getState().currentFeatureArea).toBe("im");
    expect(useImStore.getState().currentConversationId).toBe("conversation-1");

    useImStore.getState().reset();

    expect(useImStore.getState().currentFeatureArea).toBe("im");
    expect(useImStore.getState().currentConversationId).toBeNull();
  });

  it("starts with message sequence numbers hidden by default", () => {
    expect(useImStore.getState().showMessageSequenceNumbers).toBe(false);
  });

  it("restores message sequence number visibility from localStorage on reset", () => {
    window.localStorage.setItem(SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY, "true");

    useImStore.getState().reset();

    expect(useImStore.getState().showMessageSequenceNumbers).toBe(true);
  });

  it("persists message sequence number visibility when toggled", () => {
    useImStore.getState().toggleShowMessageSequenceNumbers();

    expect(useImStore.getState().showMessageSequenceNumbers).toBe(true);
    expect(window.localStorage.getItem(SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY)).toBe(
      "true",
    );

    useImStore.getState().setShowMessageSequenceNumbers(false);

    expect(useImStore.getState().showMessageSequenceNumbers).toBe(false);
    expect(window.localStorage.getItem(SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("tracks the highest realtime message sequence for unread corrections", () => {
    useImStore.getState().incrementUnreadCorrection("conversation-1", 1, 4);
    useImStore.getState().incrementUnreadCorrection("conversation-1", 2, 3);

    expect(useImStore.getState().unreadCorrections).toMatchObject({
      "conversation-1": 3,
    });
    expect(useImStore.getState().unreadCorrectionMaxMessageSeqs).toMatchObject({
      "conversation-1": 4,
    });

    useImStore.getState().clearUnreadCorrection("conversation-1");

    expect(useImStore.getState().unreadCorrections).not.toHaveProperty(
      "conversation-1",
    );
    expect(
      useImStore.getState().unreadCorrectionMaxMessageSeqs,
    ).not.toHaveProperty("conversation-1");
  });
});
