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

    const submittedBody = body;
    setValidationCode(null);
    setBody("");
    setIsSending(true);

    try {
      const result = await onSend(submittedBody);

      if (result.ok) {
        return;
      }

      if (result.code === "empty_message" || result.code === "message_too_large") {
        setValidationCode(result.code);
      }

      setBody((currentBody) => currentBody || submittedBody);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
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
      className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4"
      onSubmit={submitMessage}
    >
      {disabled && disabledReason ? (
        <p className="mb-3 rounded-[calc(var(--radius)*0.65)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--muted-foreground)]">
          {disabledReason}
        </p>
      ) : null}
      <div className="flex items-end gap-2 md:gap-3">
        <Textarea
          ref={textareaRef}
          aria-label={t("im.messageInput.label")}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-[calc(var(--radius)*0.65)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm leading-6 shadow-none"
          disabled={disabled}
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
          className="h-10 rounded-[calc(var(--radius)*0.65)] px-3 md:px-4"
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
