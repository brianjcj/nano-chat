import { MessageCircleHeart } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { MessageInput } from "@/features/im/components/MessageInput";
import { useSendDirectDraftMessage } from "@/features/im/hooks/useSendMessage";
import { useImStore } from "@/features/im/state/imStore";

export function DirectDraftView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draft = useImStore((state) => state.directDraft);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const setWorkspaceNotice = useImStore((state) => state.setWorkspaceNotice);
  const sendDraftMessage = useSendDirectDraftMessage(draft);
  const [sendErrorCode, setSendErrorCode] = useState<"send_failed" | null>(
    null,
  );

  if (!draft) {
    return (
      <section className="flex h-full min-h-0 w-full items-center justify-center rounded-[calc(var(--radius)*1.25)] border border-white/72 bg-white/54 p-8 text-center shadow-[0_30px_90px_var(--shadow-color)] backdrop-blur">
        <div className="max-w-md">
          <h2 className="text-2xl font-black tracking-tight">
            {t("im.directDraft.emptyTitle")}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
            {t("im.directDraft.emptyDescription")}
          </p>
        </div>
      </section>
    );
  }

  const title = draft.target_display_name?.trim() || draft.target_username;

  async function sendFirstMessage(body: string) {
    setSendErrorCode(null);
    const result = await sendDraftMessage.sendMessage(body);

    if (!result.ok) {
      if (result.code === "send_failed") {
        setSendErrorCode(result.code);
      }

      return result;
    }

    setDirectDraft(null);
    setWorkspaceNotice(null);
    setCurrentConversationId(result.conversationId);
    setMobilePanel("chat");
    navigate(
      `/app/im/conversations/${encodeURIComponent(result.conversationId)}`,
    );

    return { ok: true } as const;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[calc(var(--radius)*1.25)] border border-white/72 bg-white/50 shadow-[0_30px_90px_var(--shadow-color)] backdrop-blur">
      <header className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] bg-white/62 px-4 py-4 md:px-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.95)] bg-[color-mix(in_oklab,var(--primary)_16%,white)] text-[var(--primary)] shadow-[0_14px_34px_var(--shadow-color)] ring-2 ring-white/70">
          <MessageCircleHeart aria-hidden="true" className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--accent)]">
            {t("im.directDraft.title")}
          </p>
          <h2 className="truncate text-xl font-black tracking-tight md:text-2xl">
            {title}
          </h2>
          <p className="mt-1 truncate text-sm font-semibold text-[var(--muted-foreground)]">
            @{draft.target_username}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-[linear-gradient(180deg,rgb(255_255_255_/_34%),rgb(255_255_255_/_12%))] px-6 py-8 text-center">
        <div className="max-w-md rounded-[calc(var(--radius)*1.15)] border border-dashed border-[var(--border)] bg-white/58 px-6 py-5 shadow-sm">
          <p className="text-sm font-semibold leading-7 text-[var(--muted-foreground)]">
            {t("im.directDraft.description")}
          </p>
        </div>
      </div>

      {sendErrorCode ? (
        <p
          className="mx-4 mb-3 rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)] md:mx-6"
          role="alert"
        >
          {t("im.directDraft.sendFailure")}
        </p>
      ) : null}

      <MessageInput onSend={sendFirstMessage} />
    </section>
  );
}
