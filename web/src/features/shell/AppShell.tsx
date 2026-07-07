import { ArrowLeft, MessageCircleHeart, WifiOff } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { ChatView } from "@/features/im/components/ChatView";
import { ConversationList } from "@/features/im/components/ConversationList";
import { DirectDraftView } from "@/features/im/components/DirectDraftView";
import { useImStore } from "@/features/im/state/imStore";
import type { RealtimeStatus } from "@/shared/realtime/realtimeClient";
import { cn } from "@/shared/utils/cn";
import { DesktopRail } from "./DesktopRail";
import { MobileFeatureBar } from "./MobileFeatureBar";

const BANNER_STATUSES = new Set<RealtimeStatus>([
  "reconnecting",
  "draining",
  "closed",
]);

export const CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY =
  "nano-chat:conversation-sidebar-width";

const DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX = 368;
const MIN_CONVERSATION_SIDEBAR_WIDTH_PX = 288;
const MAX_CONVERSATION_SIDEBAR_WIDTH_PX = 544;
const CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX = 8;

type SidebarResizeDragState = {
  pointerId: number;
  startWidth: number;
  startX: number;
};

export function AppShell() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const directDraft = useImStore((state) => state.directDraft);
  const mobilePanel = useImStore((state) => state.mobilePanel);
  const realtimeStatus = useImStore((state) => state.realtimeStatus);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const sidebarResizeDragRef = useRef<SidebarResizeDragState | null>(null);
  const [conversationSidebarWidth, setConversationSidebarWidth] = useState(
    readConversationSidebarWidth,
  );

  function setAndPersistConversationSidebarWidth(nextWidth: number) {
    const clampedWidth = clampConversationSidebarWidth(nextWidth);
    setConversationSidebarWidth(clampedWidth);
    writeConversationSidebarWidth(clampedWidth);
  }

  function handleConversationSidebarResizePointerDown(
    event: PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    sidebarResizeDragRef.current = {
      pointerId: event.pointerId,
      startWidth: conversationSidebarWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleConversationSidebarResizePointerMove(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const resizeDrag = sidebarResizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    setAndPersistConversationSidebarWidth(
      resizeDrag.startWidth + event.clientX - resizeDrag.startX,
    );
  }

  function handleConversationSidebarResizePointerEnd(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const resizeDrag = sidebarResizeDragRef.current;

    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) {
      return;
    }

    sidebarResizeDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleConversationSidebarResizeKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") {
      nextWidth =
        conversationSidebarWidth - CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX;
    } else if (event.key === "ArrowRight") {
      nextWidth =
        conversationSidebarWidth + CONVERSATION_SIDEBAR_KEYBOARD_RESIZE_STEP_PX;
    } else if (event.key === "Home") {
      nextWidth = MIN_CONVERSATION_SIDEBAR_WIDTH_PX;
    } else if (event.key === "End") {
      nextWidth = MAX_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    setAndPersistConversationSidebarWidth(nextWidth);
  }

  useEffect(() => {
    setCurrentConversationId(conversationId ?? null);
    setMobilePanel(conversationId || directDraft ? "chat" : "conversations");
  }, [conversationId, directDraft, setCurrentConversationId, setMobilePanel]);

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex h-full min-h-0 bg-[var(--surface-muted)]">
        <DesktopRail />
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <aside
            className={cn(
              "relative h-full min-h-0 min-w-0 flex-1 flex-col border-r border-[var(--border)] bg-[var(--surface)] pb-20 md:flex md:w-[var(--conversation-sidebar-width)] md:max-w-none md:flex-none md:pb-0",
              mobilePanel === "conversations" ? "flex" : "hidden md:flex",
            )}
            style={
              {
                "--conversation-sidebar-width": `${conversationSidebarWidth}px`,
              } as CSSProperties
            }
          >
            <ConversationList />
            <div
              aria-label={t("im.conversationList.resizeHandle")}
              aria-orientation="vertical"
              aria-valuemax={MAX_CONVERSATION_SIDEBAR_WIDTH_PX}
              aria-valuemin={MIN_CONVERSATION_SIDEBAR_WIDTH_PX}
              aria-valuenow={conversationSidebarWidth}
              className="group absolute right-0 top-0 hidden h-full w-3 translate-x-1/2 cursor-col-resize touch-none items-center justify-center md:flex"
              onKeyDown={handleConversationSidebarResizeKeyDown}
              onPointerCancel={handleConversationSidebarResizePointerEnd}
              onPointerDown={handleConversationSidebarResizePointerDown}
              onPointerMove={handleConversationSidebarResizePointerMove}
              onPointerUp={handleConversationSidebarResizePointerEnd}
              role="separator"
              tabIndex={0}
            >
              <span
                aria-hidden="true"
                className="h-12 w-1 rounded-full bg-[var(--border)] transition-colors group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)]"
              />
            </div>
          </aside>

          <main
            aria-label={t("shell.mainWorkspace")}
            className={cn(
              "h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface-muted)] md:flex",
              mobilePanel === "chat" ? "flex" : "hidden md:flex",
            )}
          >
            <Workspace conversationId={conversationId ?? null} />
          </main>
        </div>
      </div>

      <ConnectionStatusBanner status={realtimeStatus} />
      <MobileFeatureBar />
    </div>
  );
}

function readConversationSidebarWidth() {
  try {
    const storedWidth = globalThis.localStorage?.getItem(
      CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY,
    );

    if (!storedWidth) {
      return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    const parsedWidth = Number(storedWidth);

    if (
      !Number.isFinite(parsedWidth) ||
      parsedWidth < MIN_CONVERSATION_SIDEBAR_WIDTH_PX ||
      parsedWidth > MAX_CONVERSATION_SIDEBAR_WIDTH_PX
    ) {
      return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
    }

    return parsedWidth;
  } catch {
    return DEFAULT_CONVERSATION_SIDEBAR_WIDTH_PX;
  }
}

function writeConversationSidebarWidth(width: number) {
  try {
    globalThis.localStorage?.setItem(
      CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY,
      String(width),
    );
  } catch {
    // Sidebar width persistence is best-effort when storage is unavailable.
  }
}

function clampConversationSidebarWidth(width: number) {
  return Math.min(
    MAX_CONVERSATION_SIDEBAR_WIDTH_PX,
    Math.max(MIN_CONVERSATION_SIDEBAR_WIDTH_PX, Math.round(width)),
  );
}

function EmptyWorkspace() {
  const { t } = useTranslation();
  const workspaceNotice = useImStore((state) => state.workspaceNotice);

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--surface-muted)] p-8 text-center">
      <div className="max-w-md">
        {workspaceNotice ? (
          <p
            className="mb-5 rounded-[calc(var(--radius)*0.75)] border border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_9%,white)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]"
            role="status"
          >
            {t(`im.notices.${workspaceNotice.type}`)}
          </p>
        ) : null}
        <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[calc(var(--radius)*0.9)] bg-[color-mix(in_oklab,var(--primary)_10%,white)] text-[var(--primary)] shadow-sm ring-1 ring-[color-mix(in_oklab,var(--primary)_18%,var(--border))]">
          <MessageCircleHeart aria-hidden="true" className="size-8" />
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
          {t("shell.placeholder.emptyTitle")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          {t("shell.placeholder.emptyDescription")}
        </p>
      </div>
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
      className="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-full border border-[var(--shell-chrome-border)] bg-[linear-gradient(135deg,var(--shell-chrome-start)_0%,var(--shell-chrome-end)_100%)] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_58px_var(--shell-chrome-shadow)] md:top-5"
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
  const directDraft = useImStore((state) => state.directDraft);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);

  function returnToConversations() {
    setDirectDraft(null);
    setCurrentConversationId(null);
    setMobilePanel("conversations");
    navigate("/app/im");
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-muted)]">
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 md:hidden">
        {conversationId || directDraft ? (
          <button
            className="inline-flex h-10 items-center gap-2 rounded-[calc(var(--radius)*0.65)] px-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
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

      <div className="flex min-h-0 flex-1 items-stretch justify-stretch">
        {conversationId ? (
          <ChatView conversationId={conversationId} />
        ) : directDraft ? (
          <DirectDraftView />
        ) : (
          <EmptyWorkspace />
        )}
      </div>
    </section>
  );
}
