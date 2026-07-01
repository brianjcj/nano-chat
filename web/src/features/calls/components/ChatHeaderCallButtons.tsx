import { Phone, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useOptionalCall } from "../CallProvider";
import type { ConversationSummary } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

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
        size="icon"
        title={audioLabel}
        type="button"
        variant="secondary"
      >
        <Phone aria-hidden="true" className="size-4" />
      </Button>
      <Button
        aria-label={videoLabel}
        disabled={isDisabled}
        onClick={() => {
          void call?.startCall(conversation, "video");
        }}
        size="icon"
        title={videoLabel}
        type="button"
        variant="secondary"
      >
        <Video aria-hidden="true" className="size-4" />
      </Button>
    </>
  );
}
