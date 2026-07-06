import { MessageCircleHeart } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

export function AuthLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_18%,color-mix(in_oklab,var(--ring)_20%,transparent),transparent_30rem),radial-gradient(circle_at_86%_12%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_32rem),linear-gradient(135deg,var(--background),#f8fbfc_52%,#e8f1f5)] text-[var(--foreground)]">
      <section className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[1fr_440px]">
        <div className="relative hidden space-y-7 lg:block">
          <div className="absolute -left-12 -top-16 size-48 rounded-full border border-white/70 bg-[color-mix(in_oklab,var(--primary)_14%,white)]/70 blur-2xl" />
          <div className="relative inline-flex items-center gap-3 rounded-full border border-[var(--border)] bg-white/70 px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] shadow-sm backdrop-blur">
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-[0_10px_30px_var(--primary-shadow)]">
              <MessageCircleHeart aria-hidden="true" className="size-5" />
            </span>
            {t("auth.layout.eyebrow")}
          </div>
          <div className="relative space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
              {t("shell.im")} · {t("shell.workspace")}
            </p>
            <h1 className="max-w-2xl text-6xl font-bold tracking-tight text-balance">
              {t("common.appName")}
            </h1>
            <p className="max-w-xl text-lg leading-8 text-[var(--muted-foreground)]">
              {t("auth.layout.description")}
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md lg:mx-0">{children}</div>
      </section>
    </main>
  );
}
