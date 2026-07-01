import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { ChatHeaderCallButtons } from "./ChatHeaderCallButtons";
import { createAppI18n } from "@/shared/i18n/i18n";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";

const remoteUser: UserSummary = {
  user_id: "1002",
  username: "bob",
  display_name: "Bob",
};

const directConversation: ConversationSummary = {
  conversation_id: "conversation-1",
  type: "direct",
  name: null,
  state: "active",
  latest_message_seq: 0,
  read_seq: 0,
  unread_count: 0,
  active_member_count: 2,
  direct_user: remoteUser,
  latest_message: null,
};

const groupConversation: ConversationSummary = {
  ...directConversation,
  conversation_id: "conversation-2",
  type: "group",
  name: "Team",
  active_member_count: 3,
  direct_user: null,
};

describe("call UI", () => {
  it("renders audio and video call buttons for direct conversations", async () => {
    await renderCallUi(
      <ChatHeaderCallButtons conversation={directConversation} disabled={false} />,
    );
    expect(screen.getByRole("button", { name: /语音通话/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /视频通话/ })).toBeEnabled();
  });

  it("does not render call buttons for group conversations", async () => {
    await renderCallUi(
      <ChatHeaderCallButtons conversation={groupConversation} disabled={false} />,
    );
    expect(screen.queryByRole("button", { name: /语音通话/ })).not.toBeInTheDocument();
  });
});

async function renderCallUi(ui: ReactElement) {
  const i18nInstance = await createAppI18n({
    language: "zh-CN",
    useLanguageDetector: false,
  });

  return render(<I18nextProvider i18n={i18nInstance}>{ui}</I18nextProvider>);
}
