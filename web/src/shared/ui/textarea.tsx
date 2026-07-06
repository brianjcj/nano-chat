import * as React from "react";

import { cn } from "@/shared/utils/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-24 w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-white/80 px-4 py-3 text-base text-[var(--foreground)] shadow-sm transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[color-mix(in_oklab,var(--ring)_36%,var(--border))] focus:bg-white focus:outline-none md:text-sm",
        className,
      )}
      {...props}
    />
  );
});

Textarea.displayName = "Textarea";
