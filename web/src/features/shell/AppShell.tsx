import { ArrowLeft, MessageCircleHeart, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { ConversationList } from "@/features/im/components/ConversationList";
import { useImStore } from "@/features/im/state/imStore";
import type { RealtimeStatus } from "@/shared/realtime/realtimeClient";
import { cn } from "@/shared/utils/cn";
import { DesktopRail } from "./DesktopRail";
import { MobileFeatureBar } from "./MobileFeatureBar";
import { UserMenu } from "./UserMenu";

const BANNER_STATUSES = new Set<RealtimeStatus>([
  "reconnecting",
  "draining",
  "closed",
]);

export function AppShell() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const mobilePanel = useImStore((state) => state.mobilePanel);
  const realtimeStatus = useImStore((state) => state.realtimeStatus);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);

  useEffect(() => {
    setCurrentConversationId(conversationId ?? null);
    setMobilePanel(conversationId ? "chat" : "conversations");
  }, [conversationId, setCurrentConversationId, setMobilePanel]);

  return (
    <div className="relative h-dvh min-h-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgb(255_190_164_/_38%),transparent_28rem),radial-gradient(circle_at_88%_10%,rgb(138_109_255_/_16%),transparent_24rem),linear-gradient(135deg,rgb(255_255_255_/_28%),transparent_45%)]" />
      <div className="relative flex h-full min-h-0">
        <DesktopRail />
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <aside
            className={cn(
              "h-full min-h-0 min-w-0 flex-1 flex-col border-r border-white/70 bg-white/32 pb-24 backdrop-blur-xl md:flex md:max-w-[24rem] md:flex-none md:pb-0",
              mobilePanel === "conversations" ? "flex" : "hidden md:flex",
            )}
          >
            <ConversationList />
          </aside>

          <main
            aria-label={t("shell.mainWorkspace")}
            className={cn(
              "h-full min-h-0 min-w-0 flex-1 flex-col pb-24 md:flex md:pb-0",
              mobilePanel === "chat" ? "flex" : "hidden md:flex",
            )}
          >
            <Workspace conversationId={conversationId ?? null} />
          </main>
        </div>
      </div>

      <div className="fixed right-4 top-4 z-40 md:right-6 md:top-5">
        <UserMenu />
      </div>
      <ConnectionStatusBanner status={realtimeStatus} />
      <MobileFeatureBar />
    </div>
  );
}

function ConnectionStatusBanner({ status }: { status: RealtimeStatus }) {
  const { t } = useTranslation();

  if (!BANNER_STATUSES.has(status)) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-full border border-white/72 bg-[color-mix(in_oklab,var(--foreground)_92%,#3d2c32)] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_58px_rgb(33_25_27_/24%)] md:top-5"
      role="status"
    >
      <WifiOff aria-hidden="true" className="size-4 text-[var(--primary)]" />
      <span>{t(`shell.connection.${status}`)}</span>
    </div>
  );
}

function Workspace({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);

  function returnToConversations() {
    setCurrentConversationId(null);
    setMobilePanel("conversations");
    navigate("/app/im");
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col px-5 py-5 md:px-8 md:py-8">
      <div className="mb-5 flex items-center justify-between md:hidden">
        {conversationId ? (
          <button
            className="inline-flex items-center gap-2 rounded-full border border-white/72 bg-white/72 px-3 py-2 text-sm font-bold text-[var(--foreground)] shadow-sm"
            onClick={returnToConversations}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("common.back")}
          </button>
        ) : (
          <span />
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative w-full max-w-3xl overflow-hidden rounded-[calc(var(--radius)*1.45)] border border-white/72 bg-white/64 p-8 shadow-[0_30px_90px_var(--shadow-color)] backdrop-blur md:p-12">
          <div className="absolute -right-20 -top-24 size-56 rounded-full bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] blur-3xl" />
          <div className="absolute -bottom-24 -left-20 size-60 rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] blur-3xl" />
          <div className="relative">
            <span className="mb-7 inline-flex size-14 items-center justify-center rounded-[calc(var(--radius)*0.95)] bg-[var(--foreground)] text-white shadow-[0_18px_45px_var(--shadow-color)]">
              <MessageCircleHeart aria-hidden="true" className="size-7" />
            </span>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-[var(--accent)]">
              {conversationId
                ? t("shell.placeholder.selectedEyebrow")
                : t("shell.placeholder.emptyEyebrow")}
            </p>
            <h2 className="max-w-2xl text-4xl font-black tracking-tight text-balance md:text-6xl">
              {conversationId
                ? t("shell.placeholder.selectedTitle")
                : t("shell.placeholder.emptyTitle")}
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted-foreground)] md:text-lg">
              {conversationId
                ? t("shell.placeholder.selectedDescription", {
                    conversationId,
                  })
                : t("shell.placeholder.emptyDescription")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
