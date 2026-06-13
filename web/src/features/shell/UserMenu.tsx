import { Languages, LogOut, PencilLine } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { useApiClient, useSession } from "@/app/AppProviders";
import { useImStore } from "@/features/im/state/imStore";
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

export function UserMenu() {
  const api = useApiClient();
  const navigate = useNavigate();
  const { clearSession, saveSession, session } = useSession();
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const visibleName = user ? user.display_name?.trim() || user.username : "";
  const avatar = useMemo(() => (user ? getAvatarVisual(user) : null), [user]);

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
    useImStore.getState().reset();
    clearSession();
    navigate("/login", { replace: true });
  }

  function openEditProfile() {
    setDisplayName(currentSession.user.display_name ?? "");
    setSaveError(null);
    setIsOpen(false);
    setIsEditOpen(true);
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
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${t("shell.userMenu.title")}: ${visibleName}`}
        className="group flex items-center gap-3 rounded-full border border-white/74 bg-white/78 py-1.5 pl-1.5 pr-4 text-left shadow-[0_18px_50px_var(--shadow-color)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white"
        onClick={() => setIsOpen((value) => !value)}
        type="button"
      >
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-full text-xs font-black tracking-tight text-white shadow-[0_10px_26px_var(--shadow-color)] ring-2 ring-white/80",
            avatar.gradientClassName,
          )}
        >
          {avatar.initials}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-36 truncate text-sm font-bold text-[var(--foreground)]">
            {visibleName}
          </span>
          <span className="block max-w-36 truncate text-xs font-semibold text-[var(--muted-foreground)]">
            @{user.username}
          </span>
        </span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-72 rounded-[calc(var(--radius)*1.05)] border border-white/78 bg-white/94 p-3 text-[var(--foreground)] shadow-[0_24px_70px_var(--shadow-color)] backdrop-blur">
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
              <p className="truncate text-xs font-semibold text-[var(--muted-foreground)]">
                @{user.username}
              </p>
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
                  中文
                </LanguageButton>
                <LanguageButton
                  active={i18n.language.startsWith("en")}
                  onClick={() => void changeLanguage("en-US")}
                >
                  English
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
        destructive && "text-[var(--destructive)] hover:bg-red-50",
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
          ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_14%,white)] text-[var(--foreground)]"
          : "border-[var(--border)] bg-white/72 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
