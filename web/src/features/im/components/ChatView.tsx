import { UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/app/AppProviders";
import { ChatHeaderCallButtons } from "@/features/calls/components/ChatHeaderCallButtons";
import { useConversationsQuery } from "@/features/im/api/imQueries";
import { MemberPanel } from "@/features/im/components/MemberPanel";
import { MessageInput } from "@/features/im/components/MessageInput";
import { MessageList } from "@/features/im/components/MessageList";
import { useConversationMessages } from "@/features/im/hooks/useConversationMessages";
import { useMarkRead } from "@/features/im/hooks/useMarkRead";
import { useSendMessage } from "@/features/im/hooks/useSendMessage";
import { useImStore } from "@/features/im/state/imStore";
import { Button } from "@/shared/ui/button";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";

export function ChatView({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const conversationsQuery = useConversationsQuery();
  const conversation = useMemo(
    () =>
      (conversationsQuery.data ?? []).find(
        (candidate) => candidate.conversation_id === conversationId,
      ) ?? null,
    [conversationId, conversationsQuery.data],
  );

  if (!conversation) {
    return (
      <ChatViewNotice
        title={
          conversationsQuery.isLoading
            ? t("common.loading")
            : t("im.chat.notFoundTitle")
        }
        description={
          conversationsQuery.isLoading
            ? t("im.chat.loadingDescription")
            : t("im.chat.notFoundDescription")
        }
      />
    );
  }

  return <LoadedChatView conversation={conversation} />;
}

function LoadedChatView({ conversation }: { conversation: ConversationSummary }) {
  const { t } = useTranslation();
  const { session } = useSession();
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(false);
  const showMessageSequenceNumbers = useImStore(
    (state) => state.showMessageSequenceNumbers,
  );
  const messagesQuery = useConversationMessages(conversation);
  const sendMessage = useSendMessage(conversation);
  const title = getConversationTitle(conversation, t);
  const subtitle = getConversationSubtitle(conversation, t);
  const disabled = conversation.state !== "active";

  useMarkRead({
    conversation,
    highestContiguousSeq: messagesQuery.highestContiguousSeq,
    isNearBottom,
  });

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-[var(--surface-muted)] shadow-none">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 md:h-[4.5rem] md:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight md:text-xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)] md:text-sm">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChatHeaderCallButtons conversation={conversation} disabled={disabled} />
          {conversation.type === "group" ? (
            <Button
              aria-label={t("im.memberPanel.title")}
              disabled={disabled}
              onClick={() => setIsMemberPanelOpen(true)}
              size="icon"
              type="button"
              variant="secondary"
            >
              <UsersRound aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      {conversation.type === "group" ? (
        <MemberPanel
          conversation={conversation}
          onOpenChange={setIsMemberPanelOpen}
          open={isMemberPanelOpen}
        />
      ) : null}

      <MessageList
        currentUserId={session?.user.user_id ?? ""}
        hasLoadedAllKnownHistory={messagesQuery.hasLoadedAllKnownHistory}
        isFetchingOlder={messagesQuery.isFetchingOlder}
        isLoading={messagesQuery.isLoading}
        isNearBottom={isNearBottom}
        loadOlder={messagesQuery.loadOlder}
        messages={messagesQuery.messages}
        onNearBottomChange={setIsNearBottom}
        onRetry={(message) => {
          void sendMessage.retryMessage(message);
        }}
        showMessageSequenceNumbers={showMessageSequenceNumbers}
      />

      <MessageInput
        disabled={disabled}
        disabledReason={disabled ? t("im.chat.dissolved") : undefined}
        onSend={sendMessage.sendMessage}
      />
    </section>
  );
}

function ChatViewNotice({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <section className="flex h-full min-h-0 w-full items-center justify-center bg-[var(--surface-muted)] p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-2xl font-black tracking-tight">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
          {description}
        </p>
      </div>
    </section>
  );
}

function getConversationTitle(
  conversation: ConversationSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (conversation.type === "direct") {
    return (
      displayUserName(conversation.direct_user) ??
      t("im.conversationList.unknownDirect")
    );
  }

  return conversation.name?.trim() || t("im.conversationList.untitledGroup");
}

function getConversationSubtitle(
  conversation: ConversationSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (conversation.type === "direct") {
    const directUser = conversation.direct_user;
    const displayName = directUser?.display_name?.trim();

    return directUser && displayName && displayName !== directUser.username
      ? `@${directUser.username}`
      : null;
  }

  return t("im.conversationList.memberCount", {
    count: conversation.active_member_count,
  });
}

function displayUserName(user: UserSummary | null) {
  if (!user) {
    return null;
  }

  return user.display_name?.trim() || user.username;
}

