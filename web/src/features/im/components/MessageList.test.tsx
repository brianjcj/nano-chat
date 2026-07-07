import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { screen, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    message_type: "text",
    metadata: {},
    created_at: `2026-06-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageList", () => {
  it("renders each chat message sent time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T23:00:00"));

    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[
          {
            ...message(1),
            created_at: "2026-07-06T14:05:00",
          },
        ]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const timestampRow = screen.getByText("14:05").closest("li");

    expect(timestampRow).toHaveClass("justify-center");
    expect(timestampRow?.nextElementSibling).toHaveTextContent("Message 1");
  });

  it("suppresses timestamps until more than five minutes after the last shown timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T23:00:00"));

    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[
          {
            ...message(1),
            created_at: "2026-07-06T14:00:00",
          },
          {
            ...message(2),
            created_at: "2026-07-06T14:04:00",
          },
          {
            ...message(3),
            created_at: "2026-07-06T14:06:00",
          },
        ]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.queryByText("14:04")).not.toBeInTheDocument();
    expect(screen.getByText("14:06")).toBeInTheDocument();
  });

  it("hides message sequence numbers by default", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(1)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });

  it("shows message sequence numbers when debug display is enabled", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(1)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
        showMessageSequenceNumbers
      />,
    );

    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("shows avatars for incoming messages and omits them for outgoing messages", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(1), message(2)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Bob avatar")).toHaveTextContent("B");
    expect(screen.queryByLabelText("Alice avatar")).not.toBeInTheDocument();
  });

  it("uses the calm outgoing bubble token instead of the action color", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[message(2)]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const outgoingBubble = screen.getByText("Message 2").closest("div");

    expect(outgoingBubble).toHaveClass("bg-[var(--bubble-outgoing)]");
    expect(outgoingBubble).toHaveClass("text-[var(--foreground)]");
    expect(outgoingBubble).not.toHaveClass("bg-[var(--primary)]");
    expect(outgoingBubble).not.toHaveClass("text-[var(--primary-foreground)]");
  });

  it("renders call event message sent time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T23:00:00"));

    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[
          {
            message_id: "m1",
            conversation_id: "c1",
            message_seq: 1,
            sender: { user_id: "1001", username: "alice", display_name: "Alice" },
            body: "视频通话 03:12",
            message_type: "call_event",
            metadata: {
              media_type: "video",
              outcome: "completed",
              duration_seconds: 192,
            },
            created_at: "2026-07-05T09:08:00",
          },
        ]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const timestampRow = screen.getByText("07-05 09:08").closest("li");

    expect(timestampRow).toHaveClass("justify-center");
    expect(timestampRow?.nextElementSibling).toHaveTextContent("视频通话 03:12");
  });

  it("labels the below-viewport shortcut as back to bottom instead of implying unread messages", async () => {
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });

    render(
      <I18nextProvider i18n={i18nInstance}>
        <MessageList
          currentUserId="1001"
          hasLoadedAllKnownHistory
          isFetchingOlder={false}
          isLoading={false}
          isNearBottom={false}
          loadOlder={vi.fn()}
          messages={[message(1)]}
          onNearBottomChange={vi.fn()}
          onRetry={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Back to bottom" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New messages" }),
    ).not.toBeInTheDocument();
  });

  it("scrolls to the bottom when a current-user message is appended while away from bottom", async () => {
    const user = userEvent.setup();
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });
    let scrollHeight = 300;
    let scrollTop = 80;
    const onNearBottomChange = vi.fn();

    function Harness() {
      const [messages, setMessages] = useState<ChatMessage[]>([
        message(1),
        message(2),
      ]);

      return (
        <I18nextProvider i18n={i18nInstance}>
          <MessageList
            currentUserId={localUser.user_id}
            hasLoadedAllKnownHistory
            isFetchingOlder={false}
            isLoading={false}
            isNearBottom={false}
            loadOlder={vi.fn()}
            messages={messages}
            onNearBottomChange={onNearBottomChange}
            onRetry={vi.fn()}
          />
          <button
            onClick={() => {
              scrollHeight = 500;
              setMessages((currentMessages) => [
                ...currentMessages,
                { ...message(4), body: "Sent while scrolled up" },
              ]);
            }}
            type="button"
          >
            Append sent message
          </button>
        </I18nextProvider>
      );
    }

    render(<Harness />);

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

    await user.click(screen.getByRole("button", { name: "Append sent message" }));

    expect(await screen.findByText("Sent while scrolled up")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollTop).toBe(500);
    });
    expect(onNearBottomChange).toHaveBeenCalledWith(true);
  });

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

  it("renders completed video call event messages", () => {
    render(
      <MessageList
        currentUserId="1001"
        hasLoadedAllKnownHistory
        isFetchingOlder={false}
        isLoading={false}
        isNearBottom
        loadOlder={vi.fn()}
        messages={[
          {
            message_id: "m1",
            conversation_id: "c1",
            message_seq: 1,
            sender: { user_id: "1001", username: "alice", display_name: "Alice" },
            body: "视频通话 03:12",
            message_type: "call_event",
            metadata: {
              media_type: "video",
              outcome: "completed",
              duration_seconds: 192,
            },
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ]}
        onNearBottomChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("视频通话 03:12")).toBeInTheDocument();
  });
});
