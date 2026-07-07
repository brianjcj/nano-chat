import { Phone, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useOptionalCall } from "../CallProvider";
import type { ConversationSummary } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

const DIRECT_CALL_BUTTON_CLASS_NAME =
  "border border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] text-[var(--primary)] shadow-[0_10px_24px_color-mix(in_oklab,var(--primary-shadow)_46%,transparent)] hover:bg-[color-mix(in_oklab,var(--primary)_12%,var(--surface))] hover:text-[var(--primary)] hover:shadow-[0_12px_28px_var(--primary-shadow)]";

export function ChatHeaderCallButtons({
  conversation,
  disabled,
}: {
  conversation: ConversationSummary;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const call = useOptionalCall();

  if (conversation.type !== "direct") {
    return null;
  }

  const isDisabled =
    disabled ||
    conversation.state !== "active" ||
    (call ? call.state.phase !== "idle" : false);
  const audioLabel = t("calls.actions.audio", { defaultValue: "语音通话" });
  const videoLabel = t("calls.actions.video", { defaultValue: "视频通话" });

  return (
    <>
      <Button
        aria-label={audioLabel}
        disabled={isDisabled}
        onClick={() => {
          void call?.startCall(conversation, "audio");
        }}
        className={DIRECT_CALL_BUTTON_CLASS_NAME}
        size="icon"
        title={audioLabel}
        type="button"
        variant="ghost"
      >
        <Phone aria-hidden="true" className="size-4" />
      </Button>
      <Button
        aria-label={videoLabel}
        disabled={isDisabled}
        onClick={() => {
          void call?.startCall(conversation, "video");
        }}
        className={DIRECT_CALL_BUTTON_CLASS_NAME}
        size="icon"
        title={videoLabel}
        type="button"
        variant="ghost"
      >
        <Video aria-hidden="true" className="size-4" />
      </Button>
    </>
  );
}
