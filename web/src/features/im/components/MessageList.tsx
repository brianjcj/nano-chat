import { ArrowDown, Loader2 } from "lucide-react";
import { Fragment, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { UserSummary } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/cn";
import { getAvatarVisual } from "@/shared/utils/avatar";
import {
  formatMessageSentTime,
  isServerSequenced,
  type ChatMessage,
} from "@/shared/utils/message";

const NEAR_BOTTOM_THRESHOLD_PX = 96;
const MESSAGE_TIMESTAMP_SUPPRESSION_MS = 5 * 60 * 1000;

type MessageListProps = {
  currentUserId: string;
  hasLoadedAllKnownHistory: boolean;
  isFetchingOlder: boolean;
  isLoading: boolean;
  isNearBottom: boolean;
  loadOlder: () => Promise<void>;
  messages: ChatMessage[];
  onNearBottomChange: (isNearBottom: boolean) => void;
  onRetry: (message: ChatMessage) => void;
  showMessageSequenceNumbers?: boolean;
};

export function MessageList({
  currentUserId,
  hasLoadedAllKnownHistory,
  isFetchingOlder,
  isLoading,
  isNearBottom,
  loadOlder,
  messages,
  onNearBottomChange,
  onRetry,
  showMessageSequenceNumbers = false,
}: MessageListProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingHistoryPrependRef = useRef<PendingHistoryPrepend | null>(null);
  const oldestMessageSeq = getMinimumMessageSeq(messages);
  const timestampedMessages = getTimestampedMessages(messages);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    const pendingHistoryPrepend = pendingHistoryPrependRef.current;

    if (pendingHistoryPrepend) {
      const didPrependOlderMessages =
        messages.length > pendingHistoryPrepend.messageCount &&
        oldestMessageSeq < pendingHistoryPrepend.oldestMessageSeq;

      if (didPrependOlderMessages) {
        pendingHistoryPrependRef.current = null;
        scrollContainer.scrollTop =
          pendingHistoryPrepend.scrollTop +
          scrollContainer.scrollHeight -
          pendingHistoryPrepend.scrollHeight;
        return;
      }

      if (!isFetchingOlder) {
        pendingHistoryPrependRef.current = null;
      }
    }

    if (isNearBottom) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [isFetchingOlder, isNearBottom, messages.length, oldestMessageSeq]);

  async function handleLoadOlderClick() {
    const scrollContainer = scrollContainerRef.current;

    if (scrollContainer) {
      pendingHistoryPrependRef.current = {
        messageCount: messages.length,
        oldestMessageSeq,
        scrollHeight: scrollContainer.scrollHeight,
        scrollTop: scrollContainer.scrollTop,
      };
    }

    await loadOlder();
  }

  function updateNearBottom() {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }

    onNearBottomChange(isScrollNearBottom(scrollContainer));
  }

  return (
    <div className="relative min-h-0 flex-1 bg-[var(--surface-muted)]">
      <div
        ref={scrollContainerRef}
        aria-label={t("im.messageList.region")}
        className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-4 md:px-6 md:py-5"
        onScroll={updateNearBottom}
      >
        <div className="mb-4 flex justify-center">
          {hasLoadedAllKnownHistory ? null : (
            <Button
              disabled={isFetchingOlder || isLoading}
              onClick={() => {
                void handleLoadOlderClick();
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              {isFetchingOlder ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {t("im.messageList.loadOlder")}
            </Button>
          )}
        </div>

        {isLoading ? (
          <MessageListNotice>{t("common.loading")}</MessageListNotice>
        ) : messages.length === 0 ? (
          <MessageListNotice>{t("im.messageList.empty")}</MessageListNotice>
        ) : (
          <ol className="mt-auto space-y-2.5">
            {timestampedMessages.map(({ message, showTimestamp }) => (
              <Fragment key={message.message_id}>
                {showTimestamp ? (
                  <MessageTimestamp createdAt={message.created_at} />
                ) : null}
                {"message_type" in message && message.message_type === "call_event" ? (
                  <CallEventMessage message={message} />
                ) : (
                  <MessageBubble
                    currentUserId={currentUserId}
                    message={message}
                    onRetry={onRetry}
                    showMessageSequenceNumber={showMessageSequenceNumbers}
                  />
                )}
              </Fragment>
            ))}
          </ol>
        )}
      </div>

      {!isNearBottom ? (
        <button
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] shadow-md"
          onClick={() => {
            const scrollContainer = scrollContainerRef.current;

            if (scrollContainer) {
              scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }

            onNearBottomChange(true);
          }}
          type="button"
        >
          <ArrowDown aria-hidden="true" className="size-3.5" />
          {t("im.messageList.backToBottom")}
        </button>
      ) : null}
    </div>
  );
}

type PendingHistoryPrepend = {
  messageCount: number;
  oldestMessageSeq: number;
  scrollHeight: number;
  scrollTop: number;
};

function MessageTimestamp({ createdAt }: { createdAt: string }) {
  return (
    <li className="flex justify-center">
      <time className="rounded-md bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-2 py-0.5 text-[0.68rem] font-medium text-[var(--muted-foreground)]">
        {formatMessageSentTime(createdAt)}
      </time>
    </li>
  );
}

function CallEventMessage({ message }: { message: ChatMessage }) {
  return (
    <li className="flex justify-center">
      <div className="max-w-[78%] rounded-full bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] px-3 py-1.5 text-center text-xs font-semibold text-[var(--muted-foreground)]">
        {message.body}
      </div>
    </li>
  );
}

function MessageBubble({
  currentUserId,
  message,
  onRetry,
  showMessageSequenceNumber,
}: {
  currentUserId: string;
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  showMessageSequenceNumber: boolean;
}) {
  const { t } = useTranslation();
  const isOutgoing = message.sender.user_id === currentUserId;
  const isFailed = message.delivery_status === "failed";
  const isPending = message.delivery_status === "pending";

  return (
    <li
      className={cn(
        "flex items-end gap-2",
        isOutgoing ? "justify-end" : "justify-start",
      )}
    >
      {!isOutgoing ? <MessageSenderAvatar user={message.sender} /> : null}
      <div
        className={cn(
          "max-w-[min(78%,42rem)] rounded-[calc(var(--radius)*0.8)] px-3.5 py-2.5 shadow-sm",
          isOutgoing
            ? "rounded-br-[0.35rem] bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "rounded-bl-[0.35rem] border border-[var(--border)] bg-[var(--bubble-incoming)] text-[var(--foreground)]",
          isFailed ? "ring-2 ring-[var(--destructive)]/40" : null,
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.body}
        </p>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] opacity-70",
            isOutgoing ? "justify-end" : "justify-start",
          )}
        >
          {showMessageSequenceNumber && isServerSequenced(message) ? (
            <span>#{message.message_seq}</span>
          ) : null}
          {isPending ? <span>{t("im.messageList.pending")}</span> : null}
          {isFailed ? <span>{t("im.messageInput.sendFailure")}</span> : null}
        </div>
        {isFailed ? (
          <button
            className={cn(
              "mt-2 text-xs font-bold underline-offset-4 hover:underline",
              isOutgoing ? "text-white" : "text-[var(--destructive)]",
            )}
            onClick={() => onRetry(message)}
            type="button"
          >
            {t("im.messageInput.retry")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function MessageSenderAvatar({ user }: { user: UserSummary }) {
  const avatar = getAvatarVisual(user);
  const label = `${displaySenderName(user)} avatar`;

  return (
    <span
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.55)] text-[0.68rem] font-bold text-white shadow-sm ring-1 ring-white/70",
        avatar.gradientClassName,
      )}
    >
      {avatar.initials}
    </span>
  );
}

function displaySenderName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}

type TimestampedChatMessage = {
  message: ChatMessage;
  showTimestamp: boolean;
};

function getTimestampedMessages(messages: ChatMessage[]): TimestampedChatMessage[] {
  let lastDisplayedTimestampMs: number | null = null;

  return messages.map((message) => {
    const sentAtMs = Date.parse(message.created_at);
    const showTimestamp =
      lastDisplayedTimestampMs === null ||
      !Number.isFinite(sentAtMs) ||
      sentAtMs - lastDisplayedTimestampMs > MESSAGE_TIMESTAMP_SUPPRESSION_MS;

    if (showTimestamp && Number.isFinite(sentAtMs)) {
      lastDisplayedTimestampMs = sentAtMs;
    }

    return { message, showTimestamp };
  });
}

function MessageListNotice({ children }: { children: string }) {
  return (
    <div className="mx-auto mt-auto max-w-sm rounded-[calc(var(--radius)*0.75)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm font-semibold text-[var(--muted-foreground)]">
      {children}
    </div>
  );
}

function isScrollNearBottom(scrollContainer: HTMLDivElement) {
  return (
    scrollContainer.scrollHeight -
      scrollContainer.scrollTop -
      scrollContainer.clientHeight <=
    NEAR_BOTTOM_THRESHOLD_PX
  );
}

function getMinimumMessageSeq(messages: ChatMessage[]) {
  const seqs = messages
    .map((message) => message.message_seq)
    .filter((messageSeq): messageSeq is number => typeof messageSeq === "number");

  if (seqs.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(...seqs);
}
