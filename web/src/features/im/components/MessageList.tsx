import { ArrowDown, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/cn";
import { isServerSequenced, type ChatMessage } from "@/shared/utils/message";

const NEAR_BOTTOM_THRESHOLD_PX = 96;

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
}: MessageListProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingHistoryPrependRef = useRef<PendingHistoryPrepend | null>(null);
  const oldestMessageSeq = getMinimumMessageSeq(messages);

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
    <div className="relative min-h-0 flex-1 bg-[linear-gradient(180deg,rgb(255_255_255_/_34%),rgb(255_255_255_/_12%))]">
      <div
        ref={scrollContainerRef}
        aria-label={t("im.messageList.region")}
        className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-5"
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
          <ol className="mt-auto space-y-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.message_id}
                currentUserId={currentUserId}
                message={message}
                onRetry={onRetry}
              />
            ))}
          </ol>
        )}
      </div>

      {!isNearBottom ? (
        <button
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/80 bg-[var(--foreground)] px-3 py-2 text-xs font-black text-white shadow-[0_14px_34px_var(--shadow-color)]"
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
          {t("im.messageList.newMessages")}
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

function MessageBubble({
  currentUserId,
  message,
  onRetry,
}: {
  currentUserId: string;
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
}) {
  const { t } = useTranslation();
  const isOutgoing = message.sender.user_id === currentUserId;
  const isFailed = message.delivery_status === "failed";
  const isPending = message.delivery_status === "pending";

  return (
    <li className={cn("flex", isOutgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-[calc(var(--radius)*1.05)] px-4 py-3 shadow-[0_14px_32px_var(--shadow-color)]",
          isOutgoing
            ? "rounded-br-md bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "rounded-bl-md border border-white/74 bg-white/84 text-[var(--foreground)]",
          isFailed ? "ring-2 ring-[var(--destructive)]/40" : null,
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.body}
        </p>
        <div
          className={cn(
            "mt-2 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] opacity-75",
            isOutgoing ? "justify-end" : "justify-start",
          )}
        >
          {isServerSequenced(message) ? (
            <span>#{message.message_seq}</span>
          ) : null}
          {isPending ? <span>{t("im.messageList.pending")}</span> : null}
          {isFailed ? <span>{t("im.messageInput.sendFailure")}</span> : null}
        </div>
        {isFailed ? (
          <button
            className={cn(
              "mt-2 text-xs font-black underline-offset-4 hover:underline",
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

function MessageListNotice({ children }: { children: string }) {
  return (
    <div className="mx-auto mt-auto max-w-sm rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white/58 px-4 py-3 text-center text-sm font-semibold text-[var(--muted-foreground)]">
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
