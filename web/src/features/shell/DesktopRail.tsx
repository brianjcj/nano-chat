import { MessageCircleHeart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { useImStore } from "@/features/im/state/imStore";
import { cn } from "@/shared/utils/cn";
import { ShellSettingsMenu } from "./ShellSettingsMenu";
import { UserMenu } from "./UserMenu";

export function DesktopRail() {
  const { t } = useTranslation();
  const setCurrentFeatureArea = useImStore(
    (state) => state.setCurrentFeatureArea,
  );
  const setMobilePanel = useImStore((state) => state.setMobilePanel);

  return (
    <aside
      aria-label={t("shell.featureRail")}
      className="hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-[var(--shell-chrome-border)] bg-[linear-gradient(180deg,var(--shell-chrome-start)_0%,var(--shell-chrome-end)_100%)] px-2.5 py-4 text-white md:flex"
    >
      <div className="mb-5">
        <UserMenu placement="rail" />
      </div>

      <nav className="flex flex-1 flex-col items-center gap-3">
        <NavLink
          className={({ isActive }) =>
            cn(
              "flex size-11 items-center justify-center rounded-[calc(var(--radius)*0.7)] text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white",
              isActive &&
                "bg-[var(--primary)] text-white shadow-[0_14px_30px_var(--primary-shadow)] hover:bg-[var(--primary)] hover:text-white",
            )
          }
          onClick={() => {
            setCurrentFeatureArea("im");
            setMobilePanel("conversations");
          }}
          title={t("shell.im")}
          to="/app/im"
        >
          <MessageCircleHeart aria-hidden="true" className="size-5" />
          <span className="sr-only">{t("shell.im")}</span>
        </NavLink>
      </nav>

      <div className="mt-5">
        <ShellSettingsMenu placement="rail" />
      </div>
    </aside>
  );
}
