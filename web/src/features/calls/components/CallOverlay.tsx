import { Phone, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/app/AppProviders";
import { useCall, type CallUiState } from "../CallProvider";
import { CallControls } from "./CallControls";
import { CallVideo } from "./CallVideo";
import type { UserSummary } from "@/shared/api/types";

export function CallOverlay() {
  const { t } = useTranslation();
  const call = useCall();
  const { session } = useSession();
  const { state } = call;

  if (state.phase === "idle" || state.phase === "incoming") {
    return null;
  }

  const summary = state.call;
  const peerUser =
    summary.caller.user_id === session?.user.user_id ? summary.callee : summary.caller;
  const localStream = hasLocalStream(state) ? state.localStream : null;
  const remoteStream = hasRemoteStream(state) ? state.remoteStream : null;
  const isActive = state.phase === "active";
  const muted = isActive ? state.muted : false;
  const cameraOff = isActive ? state.cameraOff : false;
  const isOutgoing = state.phase === "outgoing";
  const status = getStatusLabel(state, t);

  return (
    <aside className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#171417] text-white shadow-[0_30px_90px_rgba(33,25,27,0.30)] md:inset-auto md:bottom-6 md:right-6 md:h-auto md:w-[24rem] md:rounded-[calc(var(--radius)*1.4)]">
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/45">
            {status}
          </p>
          <h2 className="mt-1 truncate text-xl font-black tracking-tight">
            {displayUserName(peerUser)}
          </h2>
        </div>
        <div className="rounded-full border border-white/10 bg-white/10 p-2">
          <Phone aria-hidden="true" className="size-4" />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,#3b2f46_0%,#171417_55%)] p-5 md:min-h-[18rem]">
        {summary.media_type === "video" ? (
          <>
            {remoteStream ? (
              <CallVideo
                label={t("calls.video.remote", { defaultValue: "Remote video" })}
                stream={remoteStream}
              />
            ) : (
              <CallAvatar label={displayUserName(peerUser)} />
            )}
            {localStream ? (
              <div className="absolute bottom-5 right-5 h-32 w-24 overflow-hidden rounded-[var(--radius)] border border-white/20 bg-black/40 shadow-2xl">
                <CallVideo
                  label={t("calls.video.localPreview", {
                    defaultValue: "Local video preview",
                  })}
                  muted
                  stream={localStream}
                />
              </div>
            ) : null}
          </>
        ) : (
          <CallAvatar label={displayUserName(peerUser)} />
        )}
      </div>

      <div className="space-y-4 border-t border-white/10 bg-white/[0.06] px-5 py-5 backdrop-blur">
        {state.phase === "ended" ? (
          <p className="text-center text-sm font-semibold text-white/70">
            {t("calls.status.ended", { reason: state.reason })}
          </p>
        ) : (
          <CallControls
            cameraOff={cameraOff}
            isOutgoing={isOutgoing}
            mediaType={summary.media_type}
            muted={muted}
            onCancel={() => {
              void call.cancelOutgoing();
            }}
            onHangUp={() => {
              void call.hangUp();
            }}
            onToggleCamera={call.toggleCamera}
            onToggleMuted={call.toggleMuted}
          />
        )}
      </div>
    </aside>
  );
}

function CallAvatar({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="grid size-28 place-items-center rounded-full border border-white/15 bg-white/10 shadow-[0_20px_70px_rgba(0,0,0,0.28)]">
        <UserRound aria-hidden="true" className="size-12 text-white/72" />
      </div>
      <p className="max-w-[16rem] truncate text-lg font-black tracking-tight">
        {label}
      </p>
    </div>
  );
}

function hasLocalStream(
  state: CallUiState,
): state is Extract<CallUiState, { phase: "outgoing" | "connecting" | "active" }> {
  return (
    state.phase === "outgoing" ||
    state.phase === "connecting" ||
    state.phase === "active"
  );
}

function hasRemoteStream(
  state: CallUiState,
): state is Extract<CallUiState, { phase: "connecting" | "active" }> {
  return state.phase === "connecting" || state.phase === "active";
}

function displayUserName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}

function getStatusLabel(
  state: Exclude<CallUiState, { phase: "idle" | "incoming" }>,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (state.phase) {
    case "outgoing":
      return t("calls.status.ringing", { defaultValue: "Ringing…" });
    case "connecting":
      return t("calls.status.connecting", { defaultValue: "Connecting…" });
    case "active":
      return t("calls.status.active", { defaultValue: "Connected" });
    case "ended":
      return t("calls.status.ended", { reason: state.reason });
  }
}
