import { Languages, LogOut, PencilLine } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { useApiClient, useSession } from "@/app/AppProviders";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { getAvatarVisual } from "@/shared/utils/avatar";
import { cn } from "@/shared/utils/cn";

const LANGUAGE_STORAGE_KEY = "nano-chat.language";

type MenuLanguage = "zh-CN" | "en-US";
type UserMenuPlacement = "floating" | "rail" | "mobileBar";

type UserMenuProps = {
  placement?: UserMenuPlacement;
};

export function UserMenu({ placement = "floating" }: UserMenuProps) {
  const api = useApiClient();
  const navigate = useNavigate();
  const { clearSession, saveSession, session } = useSession();
  const { i18n, t } = useTranslation();
  const disclosurePanelId = useId();
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const trimmedProfileName = user?.display_name?.trim() ?? "";
  const visibleName = user ? trimmedProfileName || user.username : "";
  const usernameHandle =
    user && trimmedProfileName && trimmedProfileName !== user.username
      ? `@${user.username}`
      : null;
  const avatar = useMemo(() => (user ? getAvatarVisual(user) : null), [user]);

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

  if (!session || !user || !avatar) {
    return null;
  }

  const currentSession = session;

  async function changeLanguage(language: MenuLanguage) {
    await i18n.changeLanguage(language);

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Language persistence is best-effort when storage is unavailable.
    }

    setIsOpen(false);
  }

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  function openEditProfile() {
    setDisplayName(currentSession.user.display_name ?? "");
    setSaveError(null);
    setIsOpen(false);
    setIsEditOpen(true);
  }

  function closeDisclosureOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !isOpen) {
      return;
    }

    event.stopPropagation();
    setIsOpen(false);
  }

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDisplayName = displayName.trim();
    setIsSaving(true);
    setSaveError(null);

    try {
      const updatedUser = await api.patchMe({
        display_name: trimmedDisplayName ? trimmedDisplayName : null,
      });
      saveSession({ ...currentSession, user: updatedUser });
      setIsEditOpen(false);
      setIsOpen(false);
    } catch {
      setSaveError(t("shell.userMenu.saveError"));
    } finally {
      setIsSaving(false);
    }
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
        aria-label={`${t("shell.userMenu.title")}: ${visibleName}`}
        className={getTriggerClassName(placement, isOpen)}
        onClick={() => setIsOpen((value) => !value)}
        title={`${t("shell.userMenu.title")}: ${visibleName}`}
        type="button"
      >
        <span
          className={cn(
            getAvatarClassName(placement),
            avatar.gradientClassName,
          )}
        >
          {avatar.initials}
        </span>
        {placement === "rail" ? null : placement === "mobileBar" ? (
          <span className="min-w-0 truncate">{visibleName}</span>
        ) : (
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-36 truncate text-sm font-bold text-[var(--foreground)]">
              {visibleName}
            </span>
            {usernameHandle ? (
              <span className="block max-w-36 truncate text-xs font-semibold text-[var(--muted-foreground)]">
                {usernameHandle}
              </span>
            ) : null}
          </span>
        )}
      </button>

      {isOpen ? (
        <div
          aria-label={t("shell.userMenu.title")}
          className={cn(
            "absolute z-50 w-72 rounded-[calc(var(--radius)*1.05)] border border-[color-mix(in_oklab,var(--surface)_78%,var(--border))] bg-[color-mix(in_oklab,var(--surface)_94%,transparent)] p-3 text-[var(--foreground)] shadow-[0_24px_70px_var(--shadow-color)] backdrop-blur",
            getPanelPositionClassName(placement),
          )}
          id={disclosurePanelId}
          role="region"
        >
          <div className="mb-3 flex items-center gap-3 rounded-[calc(var(--radius)*0.85)] bg-[var(--surface-muted)]/70 p-3">
            <span
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-sm",
                avatar.gradientClassName,
              )}
            >
              {avatar.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{visibleName}</p>
              {usernameHandle ? (
                <p className="truncate text-xs font-semibold text-[var(--muted-foreground)]">
                  {usernameHandle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <MenuButton onClick={openEditProfile}>
              <PencilLine aria-hidden="true" className="size-4" />
              {t("shell.userMenu.editProfile")}
            </MenuButton>
            <div className="rounded-[calc(var(--radius)*0.8)] px-3 py-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                <Languages aria-hidden="true" className="size-4" />
                {t("shell.userMenu.language")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LanguageButton
                  active={i18n.language.startsWith("zh")}
                  onClick={() => void changeLanguage("zh-CN")}
                >
                  {t("shell.userMenu.languageZh")}
                </LanguageButton>
                <LanguageButton
                  active={i18n.language.startsWith("en")}
                  onClick={() => void changeLanguage("en-US")}
                >
                  {t("shell.userMenu.languageEn")}
                </LanguageButton>
              </div>
            </div>
            <MenuButton destructive onClick={logout}>
              <LogOut aria-hidden="true" className="size-4" />
              {t("shell.userMenu.logout")}
            </MenuButton>
          </div>
        </div>
      ) : null}

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <form
            className="space-y-5"
            onSubmit={(event) => void saveDisplayName(event)}
          >
            <DialogHeader>
              <DialogTitle>{t("shell.userMenu.editProfile")}</DialogTitle>
              <DialogDescription>
                {t("shell.userMenu.editProfileDescription")}
              </DialogDescription>
            </DialogHeader>

            <label className="block space-y-2 text-sm font-semibold">
              <span>{t("common.displayName")}</span>
              <Input
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("shell.userMenu.displayNamePlaceholder")}
                value={displayName}
              />
            </label>
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              {t("shell.userMenu.clearDisplayNameHint")}
            </p>
            {saveError ? (
              <p className="rounded-[var(--radius)] bg-[color-mix(in_oklab,var(--destructive)_12%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]">
                {saveError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                disabled={isSaving}
                onClick={() => setIsEditOpen(false)}
                type="button"
                variant="secondary"
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? t("common.loading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getWrapperClassName(placement: UserMenuPlacement) {
  if (placement === "mobileBar") {
    return "relative flex min-w-0 flex-1";
  }

  return "relative";
}

function getTriggerClassName(placement: UserMenuPlacement, isOpen: boolean) {
  if (placement === "rail") {
    return cn(
      "group flex size-12 items-center justify-center rounded-[calc(var(--radius)*0.9)] text-white/74 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/12 hover:text-white",
      isOpen && "bg-white/12 text-white shadow-inner",
    );
  }

  if (placement === "mobileBar") {
    return cn(
      "group flex min-h-12 w-full min-w-0 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] px-4 text-sm font-bold text-white/74 transition-all duration-200 hover:bg-white/12 hover:text-white",
      isOpen &&
        "bg-white text-[var(--foreground)] shadow-lg hover:bg-white hover:text-[var(--foreground)]",
    );
  }

  return "group flex items-center gap-3 rounded-full border border-white/74 bg-white/78 py-1.5 pl-1.5 pr-4 text-left shadow-[0_18px_50px_var(--shadow-color)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white";
}

function getAvatarClassName(placement: UserMenuPlacement) {
  if (placement === "rail") {
    return "flex size-9 items-center justify-center rounded-full text-xs font-black tracking-tight text-white shadow-[0_10px_26px_rgb(0_0_0_/18%)] ring-2 ring-white/40";
  }

  if (placement === "mobileBar") {
    return "flex size-7 shrink-0 items-center justify-center rounded-full text-[0.68rem] font-black tracking-tight text-white shadow-sm ring-1 ring-white/45";
  }

  return "flex size-10 items-center justify-center rounded-full text-xs font-black tracking-tight text-white shadow-[0_10px_26px_var(--shadow-color)] ring-2 ring-white/80";
}

function getPanelPositionClassName(placement: UserMenuPlacement) {
  if (placement === "rail") {
    return "left-[calc(100%+0.75rem)] top-0";
  }

  if (placement === "mobileBar") {
    return "bottom-[calc(100%+0.75rem)] right-0";
  }

  return "right-0 top-[calc(100%+0.75rem)]";
}

function MenuButton({
  children,
  destructive = false,
  onClick,
}: {
  children: ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-[calc(var(--radius)*0.8)] px-3 py-2.5 text-left text-sm font-bold transition-colors hover:bg-[var(--surface-muted)]",
        destructive &&
          "text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,var(--surface))]",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function LanguageButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-[calc(var(--radius)*0.65)] border px-3 py-2 text-sm font-bold transition-colors",
        active
          ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_14%,var(--surface))] text-[var(--foreground)]"
          : "border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
