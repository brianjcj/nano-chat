import { MessageCircleHeart, MessagesSquare, UserPlus, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { useConversationsQuery } from "@/features/im/api/imQueries";
import { CreateGroupDialog } from "@/features/im/components/CreateGroupDialog";
import { NewDirectDialog } from "@/features/im/components/NewDirectDialog";
import { useImStore } from "@/features/im/state/imStore";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";
import { getAvatarVisual } from "@/shared/utils/avatar";
import { cn } from "@/shared/utils/cn";
import { formatConversationListTime } from "@/shared/utils/message";

export function ConversationList() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams<{
    conversationId?: string;
  }>();
  const conversationsQuery = useConversationsQuery();
  const [isNewDirectOpen, setIsNewDirectOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const unreadCorrections = useImStore((state) => state.unreadCorrections);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const setWorkspaceNotice = useImStore((state) => state.setWorkspaceNotice);

  function selectConversation(conversationId: string) {
    setDirectDraft(null);
    setWorkspaceNotice(null);
    setCurrentConversationId(conversationId);
    setMobilePanel("chat");
    navigate(`/app/im/conversations/${encodeURIComponent(conversationId)}`);
  }

  return (
    <section
      aria-label={t("im.conversationList.region")}
      className="flex h-full min-h-0 flex-1 flex-col bg-[var(--surface)]"
    >
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 md:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">
              {t("im.conversationList.title")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-label={t("im.conversationList.newDirect")}
              className="inline-flex size-9 items-center justify-center rounded-[calc(var(--radius)*0.6)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
              onClick={() => setIsNewDirectOpen(true)}
              title={t("im.conversationList.newDirect")}
              type="button"
            >
              <UserPlus aria-hidden="true" className="size-4" />
            </button>
            <button
              aria-label={t("im.conversationList.createGroup")}
              className="inline-flex size-9 items-center justify-center rounded-[calc(var(--radius)*0.6)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
              onClick={() => setIsCreateGroupOpen(true)}
              title={t("im.conversationList.createGroup")}
              type="button"
            >
              <UsersRound aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        <NewDirectDialog
          onOpenChange={setIsNewDirectOpen}
          open={isNewDirectOpen}
        />
        <CreateGroupDialog
          onOpenChange={setIsCreateGroupOpen}
          open={isCreateGroupOpen}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversationsQuery.isLoading ? (
          <ConversationListNotice>{t("common.loading")}</ConversationListNotice>
        ) : conversationsQuery.isError ? (
          <ConversationListNotice>
            {t("im.conversationList.error")}
          </ConversationListNotice>
        ) : (conversationsQuery.data ?? []).length === 0 ? (
          <EmptyConversations />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(conversationsQuery.data ?? []).map((conversation) => {
              const unreadCount = getUnreadCount(
                conversation,
                unreadCorrections[conversation.conversation_id] ?? 0,
              );
              const title = getConversationTitle(conversation, t);
              const subtitle = getConversationSubtitle(conversation, t);
              const latestPreview = getLatestPreview(conversation, t);
              const latestTime = getLatestTime(conversation, i18n.language);
              const isActive =
                routeConversationId === conversation.conversation_id;

              return (
                <li key={conversation.conversation_id}>
                  <button
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-none border-b border-transparent px-4 py-3 text-left shadow-none transition-colors duration-150 last:border-b-0 md:px-5",
                      isActive
                        ? "bg-[color-mix(in_oklab,var(--primary)_10%,var(--surface))]"
                        : "bg-transparent hover:bg-[var(--surface-muted)]",
                    )}
                    onClick={() =>
                      selectConversation(conversation.conversation_id)
                    }
                    type="button"
                  >
                    <ConversationAvatar conversation={conversation} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-[0.95rem] font-semibold text-[var(--foreground)]">
                            {title}
                          </span>
                          {subtitle ? (
                            <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                              {subtitle}
                            </span>
                          ) : null}
                        </span>
                        {latestTime || unreadCount > 0 ? (
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {latestTime ? (
                              <time
                                className="text-xs font-bold tabular-nums text-[var(--muted-foreground)]"
                                dateTime={conversation.latest_message?.created_at}
                              >
                                {latestTime}
                              </time>
                            ) : null}
                            {unreadCount > 0 ? (
                              <span
                                aria-label={t("im.conversationList.unread", {
                                  count: unreadCount,
                                })}
                                className="min-w-6 rounded-full bg-[var(--primary)] px-2 py-0.5 text-center text-xs font-extrabold tabular-nums text-white shadow-[0_10px_22px_var(--primary-shadow)]"
                              >
                                {unreadCount}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-sm leading-5 text-[var(--muted-foreground)]">
                        {latestPreview}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ConversationAvatar({
  conversation,
}: {
  conversation: ConversationSummary;
}) {
  if (conversation.type === "direct" && conversation.direct_user) {
    const avatar = getAvatarVisual(conversation.direct_user);

    return (
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.65)] text-sm font-bold tracking-tight text-white shadow-sm ring-1 ring-white/70",
          avatar.gradientClassName,
        )}
      >
        {avatar.initials}
      </span>
    );
  }

  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.65)] bg-[color-mix(in_oklab,var(--accent)_14%,white)] text-[var(--accent)] shadow-sm ring-1 ring-white/70">
      <MessageCircleHeart aria-hidden="true" className="size-5" />
    </span>
  );
}

function EmptyConversations() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-[calc(var(--radius)*1.1)] border border-dashed border-[var(--border)] bg-white/44 px-6 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--primary)]">
        <MessagesSquare aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-lg font-bold tracking-tight">
        {t("im.conversationList.emptyTitle")}
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--muted-foreground)]">
        {t("im.conversationList.emptyDescription")}
      </p>
    </div>
  );
}

function ConversationListNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white/62 px-4 py-3 text-sm font-semibold text-[var(--muted-foreground)] shadow-sm">
      {children}
    </div>
  );
}

function getUnreadCount(conversation: ConversationSummary, correction: number) {
  return Math.max(0, conversation.unread_count + correction);
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

function getLatestPreview(
  conversation: ConversationSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (conversation.latest_message?.body) {
    return conversation.latest_message.body;
  }

  if (conversation.type === "group" && conversation.state === "active") {
    return t("im.conversationList.activeEmptyGroup");
  }

  return t("im.conversationList.emptyLatest");
}

function getLatestTime(conversation: ConversationSummary, locale: string) {
  const createdAt = conversation.latest_message?.created_at;

  return createdAt ? formatConversationListTime(createdAt, locale) : "";
}

function displayUserName(user: UserSummary | null) {
  if (!user) {
    return null;
  }

  return user.display_name?.trim() || user.username;
}
