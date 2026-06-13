import { beforeEach, describe, expect, it } from "vitest";

import { useImStore } from "./imStore";

describe("IM store feature area", () => {
  beforeEach(() => {
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
