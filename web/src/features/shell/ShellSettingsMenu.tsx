import { Settings } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { useImStore } from "@/features/im/state/imStore";
import { cn } from "@/shared/utils/cn";

type ShellSettingsMenuPlacement = "rail" | "mobileBar";

type ShellSettingsMenuProps = {
  placement: ShellSettingsMenuPlacement;
};

export function ShellSettingsMenu({ placement }: ShellSettingsMenuProps) {
  const { t } = useTranslation();
  const disclosurePanelId = useId();
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const showMessageSequenceNumbers = useImStore(
    (state) => state.showMessageSequenceNumbers,
  );
  const toggleShowMessageSequenceNumbers = useImStore(
    (state) => state.toggleShowMessageSequenceNumbers,
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsidePointerDown(event: Event) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (menuRootRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isOpen]);

  function closeDisclosureOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !isOpen) {
      return;
    }

    event.stopPropagation();
    setIsOpen(false);
  }

  return (
    <div
      ref={menuRootRef}
      className={getWrapperClassName(placement)}
      onKeyDown={closeDisclosureOnEscape}
    >
      <button
        aria-controls={disclosurePanelId}
        aria-expanded={isOpen}
        aria-label={t("shell.settings.title")}
        className={getTriggerClassName(placement, isOpen)}
        onClick={() => setIsOpen((value) => !value)}
        title={t("shell.settings.title")}
        type="button"
      >
        <Settings aria-hidden="true" className="size-5" />
        {placement === "mobileBar" ? (
          <span className="hidden text-sm font-bold min-[420px]:inline">
            {t("shell.settings.title")}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          aria-label={t("shell.settings.title")}
          className={cn(
            "absolute z-50 w-80 rounded-[calc(var(--radius)*1.05)] border border-white/78 bg-white/94 p-3 text-[var(--foreground)] shadow-[0_24px_70px_var(--shadow-color)] backdrop-blur",
            getPanelPositionClassName(placement),
          )}
          id={disclosurePanelId}
          role="region"
        >
          <div className="mb-3 rounded-[calc(var(--radius)*0.85)] bg-[var(--surface-muted)]/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-black">
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--foreground)] text-white shadow-sm">
                <Settings aria-hidden="true" className="size-4" />
              </span>
              {t("shell.settings.title")}
            </div>
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              {t("shell.settings.description")}
            </p>
          </div>

          <div className="space-y-2">
            <p className="px-1 text-xs font-black uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              {t("shell.settings.messageDisplay")}
            </p>
            <button
              aria-checked={showMessageSequenceNumbers}
              aria-label={t("im.chat.sequenceToggleAria")}
              className="flex w-full items-center justify-between gap-3 rounded-[calc(var(--radius)*0.85)] border border-[var(--border)] bg-white/72 p-3 text-left transition-colors hover:bg-white"
              onClick={toggleShowMessageSequenceNumbers}
              role="switch"
              type="button"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold">
                  {t("im.chat.sequenceToggleAria")}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                  {t("shell.settings.sequenceDescription")}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
                  showMessageSequenceNumbers
                    ? "border-[var(--primary)] bg-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--surface-muted)]",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform",
                    showMessageSequenceNumbers
                      ? "translate-x-5"
                      : "translate-x-1",
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getWrapperClassName(placement: ShellSettingsMenuPlacement) {
  if (placement === "mobileBar") {
    return "relative flex-none";
  }

  return "relative";
}

function getTriggerClassName(
  placement: ShellSettingsMenuPlacement,
  isOpen: boolean,
) {
  if (placement === "mobileBar") {
    return cn(
      "group flex min-h-12 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] px-4 text-white/74 transition-all duration-200 hover:bg-white/12 hover:text-white",
      isOpen &&
        "bg-white text-[var(--foreground)] shadow-lg hover:bg-white hover:text-[var(--foreground)]",
    );
  }

  return cn(
    "group flex size-12 items-center justify-center rounded-[calc(var(--radius)*0.9)] text-white/74 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/12 hover:text-white",
    isOpen && "bg-white/12 text-white shadow-inner",
  );
}

function getPanelPositionClassName(placement: ShellSettingsMenuPlacement) {
  if (placement === "mobileBar") {
    return "bottom-[calc(100%+0.75rem)] right-0";
  }

  return "bottom-0 left-[calc(100%+0.75rem)]";
}
