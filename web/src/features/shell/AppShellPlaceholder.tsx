import { MessageCircleHeart } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRealtimeBridge } from "@/shared/realtime/useRealtimeBridge";

export function AppShellPlaceholder() {
  const { t } = useTranslation();
  useRealtimeBridge();

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-3xl rounded-[calc(var(--radius)*1.4)] border border-white/70 bg-[color-mix(in_oklab,var(--surface)_90%,white)] p-8 shadow-[0_28px_80px_var(--shadow-color)] backdrop-blur md:p-12">
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-[var(--border)] bg-white/70 px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-[0_10px_30px_var(--primary-shadow)]">
              <MessageCircleHeart aria-hidden="true" className="size-5" />
            </span>
            {t("shell.im")} · {t("shell.workspace")}
          </div>
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
              {t("shell.placeholder.title")}
            </p>
            <h1 className="text-5xl font-bold tracking-tight text-balance md:text-7xl">
              {t("common.appName")}
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
              {t("shell.placeholder.description")}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
