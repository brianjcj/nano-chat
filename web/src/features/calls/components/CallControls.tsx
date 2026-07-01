import { Mic, MicOff, PhoneOff, Video, VideoOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";

export function CallControls({
  cameraOff,
  isOutgoing,
  mediaType,
  muted,
  onCancel,
  onHangUp,
  onToggleCamera,
  onToggleMuted,
}: {
  cameraOff: boolean;
  isOutgoing: boolean;
  mediaType: "audio" | "video";
  muted: boolean;
  onCancel: () => void;
  onHangUp: () => void;
  onToggleCamera: () => void;
  onToggleMuted: () => void;
}) {
  const { t } = useTranslation();
  const muteLabel = muted
    ? t("calls.actions.unmute", { defaultValue: "Unmute" })
    : t("calls.actions.mute", { defaultValue: "Mute" });
  const cameraLabel = cameraOff
    ? t("calls.actions.cameraOn", { defaultValue: "Turn camera on" })
    : t("calls.actions.cameraOff", { defaultValue: "Turn camera off" });
  const endLabel = isOutgoing
    ? t("calls.actions.cancel", { defaultValue: "Cancel" })
    : t("calls.actions.hangUp", { defaultValue: "Hang up" });

  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        aria-label={muteLabel}
        disabled={isOutgoing}
        onClick={onToggleMuted}
        size="icon"
        type="button"
        variant="secondary"
      >
        {muted ? (
          <MicOff aria-hidden="true" className="size-4" />
        ) : (
          <Mic aria-hidden="true" className="size-4" />
        )}
      </Button>
      {mediaType === "video" ? (
        <Button
          aria-label={cameraLabel}
          disabled={isOutgoing}
          onClick={onToggleCamera}
          size="icon"
          type="button"
          variant="secondary"
        >
          {cameraOff ? (
            <VideoOff aria-hidden="true" className="size-4" />
          ) : (
            <Video aria-hidden="true" className="size-4" />
          )}
        </Button>
      ) : null}
      <Button
        aria-label={endLabel}
        onClick={isOutgoing ? onCancel : onHangUp}
        size="icon"
        type="button"
        variant="destructive"
      >
        {isOutgoing ? (
          <X aria-hidden="true" className="size-4" />
        ) : (
          <PhoneOff aria-hidden="true" className="size-4" />
        )}
      </Button>
    </div>
  );
}
