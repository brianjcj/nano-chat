import { MessageCircleHeart } from "lucide-react";

export function App() {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <div className="relative w-full max-w-3xl rounded-[calc(var(--radius)*1.4)] border border-white/70 bg-[color-mix(in_oklab,var(--surface)_90%,white)] p-8 shadow-[0_28px_80px_var(--shadow-color)] backdrop-blur md:p-12">
          <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent opacity-60" />
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-[var(--border)] bg-white/70 px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-[0_10px_30px_var(--primary-shadow)]">
              <MessageCircleHeart aria-hidden="true" className="size-5" />
            </span>
            Soft-social IM workspace
          </div>
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
              Web application shell
            </p>
            <h1 className="text-5xl font-bold tracking-tight text-balance md:text-7xl">
              Nano Chat
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
              A calm, rounded foundation for realtime conversations. Authentication,
              routing, API calls, and IM flows will build on this shell in later tasks.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
