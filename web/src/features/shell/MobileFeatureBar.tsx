import { MessageCircleHeart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { useImStore } from "@/features/im/state/imStore";
import { cn } from "@/shared/utils/cn";
import { ShellSettingsMenu } from "./ShellSettingsMenu";
import { UserMenu } from "./UserMenu";

export function MobileFeatureBar() {
  const { t } = useTranslation();
  const setCurrentFeatureArea = useImStore(
    (state) => state.setCurrentFeatureArea,
  );
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const mobilePanel = useImStore((state) => state.mobilePanel);

  if (mobilePanel === "chat") {
    return null;
  }

  return (
    <nav
      aria-label={t("shell.mobileFeatureBar")}
      className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-center gap-2 rounded-[calc(var(--radius)*1.05)] border border-[var(--shell-chrome-border)] bg-[linear-gradient(135deg,var(--shell-chrome-start)_0%,var(--shell-chrome-end)_100%)] p-2 text-white shadow-[0_24px_70px_var(--shell-chrome-shadow)] backdrop-blur md:hidden"
    >
      <NavLink
        className={({ isActive }) =>
          cn(
            "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] px-4 text-sm font-bold text-white/74 transition-all duration-200",
            isActive && "bg-[var(--primary)] text-white shadow-[0_14px_30px_var(--primary-shadow)]",
          )
        }
        onClick={() => {
          setCurrentFeatureArea("im");
          setCurrentConversationId(null);
          setMobilePanel("conversations");
        }}
        to="/app/im"
      >
        <MessageCircleHeart aria-hidden="true" className="size-5" />
        {t("shell.im")}
      </NavLink>
      <UserMenu placement="mobileBar" />
      <ShellSettingsMenu placement="mobileBar" />
    </nav>
  );
}
