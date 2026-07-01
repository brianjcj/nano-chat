import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useCall } from "../CallProvider";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

const RINGTONE_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

export function IncomingCallDialog() {
  const { t } = useTranslation();
  const call = useCall();
  const { state } = call;
  const isOpen = state.phase === "incoming";
  const incomingCall = isOpen ? state.call : null;

  useEffect(() => {
    if (!isOpen || typeof Audio === "undefined") {
      return undefined;
    }

    const ringtone = new Audio(RINGTONE_DATA_URI);
    ringtone.loop = true;
    void ringtone.play().catch(() => undefined);

    return () => {
      ringtone.pause();
      ringtone.currentTime = 0;
    };
  }, [isOpen]);

  if (!incomingCall) {
    return null;
  }

  const callerName =
    incomingCall.caller.display_name?.trim() || incomingCall.caller.username;
  const statusKey =
    incomingCall.media_type === "video"
      ? "calls.status.incomingVideo"
      : "calls.status.incomingAudio";

  return (
    <Dialog open={isOpen}>
      <DialogContent className="border-[var(--accent)]/20 bg-white/95">
        <DialogHeader>
          <DialogTitle>{t(statusKey, { name: callerName })}</DialogTitle>
          <DialogDescription>
            {t("calls.status.ringing", { defaultValue: "Ringing…" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              void call.rejectIncoming();
            }}
            type="button"
            variant="secondary"
          >
            {t("calls.actions.reject", { defaultValue: "Reject" })}
          </Button>
          <Button
            onClick={() => {
              void call.acceptIncoming();
            }}
            type="button"
          >
            {t("calls.actions.accept", { defaultValue: "Accept" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
