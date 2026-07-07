import * as React from "react";

import { cn } from "@/shared/utils/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, type = "text", ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] px-4 py-2 text-base text-[var(--foreground)] shadow-sm transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[color-mix(in_oklab,var(--ring)_36%,var(--border))] focus:bg-[var(--surface)] focus:outline-none md:text-sm",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
