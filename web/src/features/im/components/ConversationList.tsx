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

export function ConversationList() {
  const { t } = useTranslation();
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
      className="flex h-full min-h-0 flex-1 flex-col bg-[color-mix(in_oklab,var(--surface)_86%,transparent)]"
    >
      <header className="border-b border-[var(--border)] px-5 pb-4 pt-5 md:px-6 md:pt-6">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[calc(var(--radius)*0.8)] bg-[var(--foreground)] text-white shadow-[0_14px_34px_var(--shadow-color)]">
            <MessagesSquare aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              {t("shell.im")}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("im.conversationList.title")}
            </h1>
          </div>
        </div>
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {t("im.conversationList.subtitle")}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] border border-[var(--border)] bg-white/72 px-3 py-2 text-sm font-black text-[var(--foreground)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white"
            onClick={() => setIsNewDirectOpen(true)}
            type="button"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            {t("im.conversationList.newDirect")}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] border border-[var(--border)] bg-white/72 px-3 py-2 text-sm font-black text-[var(--foreground)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white"
            onClick={() => setIsCreateGroupOpen(true)}
            type="button"
          >
            <UsersRound aria-hidden="true" className="size-4" />
            {t("im.conversationList.createGroup")}
          </button>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4">
        {conversationsQuery.isLoading ? (
          <ConversationListNotice>{t("common.loading")}</ConversationListNotice>
        ) : conversationsQuery.isError ? (
          <ConversationListNotice>
            {t("im.conversationList.error")}
          </ConversationListNotice>
        ) : (conversationsQuery.data ?? []).length === 0 ? (
          <EmptyConversations />
        ) : (
          <ul className="space-y-2">
            {(conversationsQuery.data ?? []).map((conversation) => {
              const unreadCount = getUnreadCount(
                conversation,
                unreadCorrections[conversation.conversation_id] ?? 0,
              );
              const title = getConversationTitle(conversation, t);
              const subtitle = getConversationSubtitle(conversation, t);
              const latestPreview = getLatestPreview(conversation, t);
              const isActive =
                routeConversationId === conversation.conversation_id;

              return (
                <li key={conversation.conversation_id}>
                  <button
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-[calc(var(--radius)*0.95)] border px-3 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_var(--shadow-color)]",
                      isActive
                        ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_12%,white)] shadow-[0_14px_34px_var(--primary-shadow)]"
                        : "border-transparent bg-white/58 hover:border-white/80 hover:bg-white/82",
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
                          <span className="block truncate text-sm font-bold text-[var(--foreground)]">
                            {title}
                          </span>
                          {subtitle ? (
                            <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--muted-foreground)]">
                              {subtitle}
                            </span>
                          ) : null}
                        </span>
                        {unreadCount > 0 ? (
                          <span
                            aria-label={t("im.conversationList.unread", {
                              count: unreadCount,
                            })}
                            className="mt-0.5 min-w-6 rounded-full bg-[var(--primary)] px-2 py-0.5 text-center text-xs font-extrabold tabular-nums text-white shadow-[0_10px_22px_var(--primary-shadow)]"
                          >
                            {unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 block truncate text-sm leading-5 text-[var(--muted-foreground)]">
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
          "flex size-12 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] text-sm font-black tracking-tight text-white shadow-[0_12px_26px_var(--shadow-color)] ring-2 ring-white/70",
          avatar.gradientClassName,
        )}
      >
        {avatar.initials}
      </span>
    );
  }

  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-[color-mix(in_oklab,var(--accent)_18%,white)] text-[var(--accent)] shadow-[0_12px_26px_var(--shadow-color)] ring-2 ring-white/70">
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
    return conversation.direct_user?.username
      ? `@${conversation.direct_user.username}`
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

function displayUserName(user: UserSummary | null) {
  if (!user) {
    return null;
  }

  return user.display_name?.trim() || user.username;
}
