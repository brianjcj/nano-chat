import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  validateMessageBody,
  type MessageValidationResult,
} from "@/shared/utils/message";

type MessageInputProps = {
  disabled?: boolean;
  disabledReason?: string;
  onSend: (body: string) => Promise<MessageValidationResult | { ok: false; code: "send_failed" }>;
};

export function MessageInput({
  disabled = false,
  disabledReason,
  onSend,
}: MessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState("");
  const [validationCode, setValidationCode] = useState<
    "empty_message" | "message_too_large" | null
  >(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [body]);

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (disabled || isSending) {
      return;
    }

    const validation = validateMessageBody(body);

    if (!validation.ok) {
      setValidationCode(validation.code);
      return;
    }

    setValidationCode(null);
    setIsSending(true);

    try {
      const result = await onSend(body);

      if (result.ok) {
        setBody("");
        return;
      }

      if (result.code === "empty_message" || result.code === "message_too_large") {
        setValidationCode(result.code);
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }

  return (
    <form
      className="border-t border-[var(--border)] bg-white/58 px-4 py-4 backdrop-blur md:px-6"
      onSubmit={submitMessage}
    >
      {disabled && disabledReason ? (
        <p className="mb-3 rounded-[var(--radius)] border border-[var(--border)] bg-white/70 px-3 py-2 text-sm font-semibold text-[var(--muted-foreground)]">
          {disabledReason}
        </p>
      ) : null}
      <div className="flex items-end gap-3">
        <Textarea
          ref={textareaRef}
          aria-label={t("im.messageInput.label")}
          className="max-h-44 min-h-12 flex-1 resize-none rounded-[calc(var(--radius)*1.05)] bg-white/86 py-3 pr-4 text-sm leading-6 shadow-[0_12px_32px_var(--shadow-color)]"
          disabled={disabled || isSending}
          onChange={(event) => {
            setBody(event.target.value);
            if (validationCode) {
              setValidationCode(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("im.messageInput.placeholder")}
          rows={1}
          value={body}
        />
        <Button
          aria-label={t("im.messageInput.send")}
          className="h-12 rounded-[calc(var(--radius)*0.95)] px-4"
          disabled={disabled || isSending}
          type="submit"
        >
          <SendHorizontal aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{t("im.messageInput.send")}</span>
        </Button>
      </div>
      {validationCode ? (
        <p className="mt-2 text-sm font-semibold text-[var(--destructive)]" role="alert">
          {t(`im.messageInput.${validationCode === "empty_message" ? "empty" : "tooLarge"}`)}
        </p>
      ) : null}
    </form>
  );
}
