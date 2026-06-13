import { MessageCircleHeart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { useImStore } from "@/features/im/state/imStore";
import { cn } from "@/shared/utils/cn";

export function MobileFeatureBar() {
  const { t } = useTranslation();
  const setCurrentFeatureArea = useImStore(
    (state) => state.setCurrentFeatureArea,
  );
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);

  return (
    <nav
      aria-label={t("shell.mobileFeatureBar")}
      className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-center rounded-[calc(var(--radius)*1.05)] border border-white/72 bg-[color-mix(in_oklab,var(--foreground)_91%,#3d2c32)] p-2 text-white shadow-[0_24px_70px_rgb(33_25_27_/26%)] backdrop-blur md:hidden"
    >
      <NavLink
        className={({ isActive }) =>
          cn(
            "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] px-4 text-sm font-bold text-white/74 transition-all duration-200",
            isActive && "bg-white text-[var(--foreground)] shadow-lg",
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
    </nav>
  );
}
