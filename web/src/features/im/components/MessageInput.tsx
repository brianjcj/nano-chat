import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  validateMessageBody,
  type MessageValidationResult,
} from "@/shared/utils/message";

type ValidationCode = "empty_message" | "message_too_large";

type ValidationNotice = {
  code: ValidationCode;
  id: number;
};

type MessageInputProps = {
  disabled?: boolean;
  disabledReason?: string;
  onSend: (body: string) => Promise<MessageValidationResult | { ok: false; code: "send_failed" }>;
};

const VALIDATION_NOTICE_TIMEOUT_MS = 2000;

export function MessageInput({
  disabled = false,
  disabledReason,
  onSend,
}: MessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const validationNoticeIdRef = useRef(0);
  const [body, setBody] = useState("");
  const [validationNotice, setValidationNotice] = useState<ValidationNotice | null>(null);
  const [isSending, setIsSending] = useState(false);
  const validationCode = validationNotice?.code ?? null;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [body]);

  useEffect(() => {
    if (!validationNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setValidationNotice((currentNotice) =>
        currentNotice?.id === validationNotice.id ? null : currentNotice,
      );
    }, VALIDATION_NOTICE_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [validationNotice]);

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (disabled || isSending) {
      return;
    }

    const validation = validateMessageBody(body);

    if (!validation.ok) {
      showValidationNotice(validation.code);
      return;
    }

    const submittedBody = body;
    setValidationNotice(null);
    setBody("");
    setIsSending(true);

    try {
      const result = await onSend(submittedBody);

      if (result.ok) {
        return;
      }

      if (result.code === "empty_message" || result.code === "message_too_large") {
        showValidationNotice(result.code);
      }

      setBody((currentBody) => currentBody || submittedBody);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function showValidationNotice(code: ValidationCode) {
    validationNoticeIdRef.current += 1;
    setValidationNotice({ code, id: validationNoticeIdRef.current });
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
      className="relative shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4"
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
            if (validationNotice) {
              setValidationNotice(null);
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
        <p
          className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--destructive)]/25 bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_12px_30px_rgb(98_63_48_/16%)] ring-1 ring-white/80"
          role="alert"
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--destructive)]/12 text-xs font-black text-[var(--destructive)]"
          >
            !
          </span>
          <span>{t(`im.messageInput.${validationCode === "empty_message" ? "empty" : "tooLarge"}`)}</span>
        </p>
      ) : null}
    </form>
  );
}
