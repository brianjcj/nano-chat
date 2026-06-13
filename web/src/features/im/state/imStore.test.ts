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
});
