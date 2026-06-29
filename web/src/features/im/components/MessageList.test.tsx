import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { screen, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageList } from "./MessageList";
import type { Message, UserSummary } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import type { ChatMessage } from "@/shared/utils/message";

const localUser: UserSummary = {
  user_id: "1001",
  username: "alice",
  display_name: "Alice",
};

const remoteUser: UserSummary = {
  user_id: "1002",
  username: "bob",
  display_name: "Bob",
};

function message(seq: number): Message {
  return {
    message_id: `message-${seq}`,
    conversation_id: "conversation-1",
    message_seq: seq,
    sender: seq % 2 === 0 ? localUser : remoteUser,
    body: `Message ${seq}`,
    created_at: `2026-06-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

describe("MessageList", () => {
  it("preserves scroll position when older history is prepended", async () => {
    const user = userEvent.setup();
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });
    let scrollHeight = 300;
    let scrollTop = 120;

    function Harness() {
      const [messages, setMessages] = useState<ChatMessage[]>([
        message(3),
        message(4),
      ]);
      const [isFetchingOlder, setIsFetchingOlder] = useState(false);

      return (
        <MessageList
          currentUserId={localUser.user_id}
          hasLoadedAllKnownHistory={false}
          isFetchingOlder={isFetchingOlder}
          isLoading={false}
          isNearBottom={false}
          loadOlder={async () => {
            setIsFetchingOlder(true);
            await Promise.resolve();
            scrollHeight = 480;
            setMessages((currentMessages) => [
              message(1),
              message(2),
              ...currentMessages,
            ]);
            setIsFetchingOlder(false);
          }}
          messages={messages}
          onNearBottomChange={vi.fn()}
          onRetry={vi.fn()}
        />
      );
    }

    render(
      <I18nextProvider i18n={i18nInstance}>
        <Harness />
      </I18nextProvider>,
    );

    const scrollContainer = screen.getByLabelText("Message list");
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 180,
    });
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    await screen.findByText("Message 3");

    await user.click(screen.getByRole("button", { name: "Load older messages" }));

    expect(await screen.findByText("Message 1")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollTop).toBe(300);
    });
  });
});
