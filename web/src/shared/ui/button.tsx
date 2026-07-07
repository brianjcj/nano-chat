import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/shared/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_14px_30px_var(--primary-shadow)] hover:translate-y-[-1px] hover:brightness-105 active:translate-y-0",
        secondary:
          "border border-[color-mix(in_oklab,var(--surface)_72%,var(--border))] bg-[color-mix(in_oklab,var(--surface)_76%,transparent)] text-[var(--foreground)] shadow-sm hover:border-[color-mix(in_oklab,var(--primary)_28%,var(--border))] hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--surface))]",
        ghost:
          "text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
        destructive:
          "bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow-sm hover:brightness-105",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-5",
        lg: "h-12 px-6 text-base",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ className, size, variant }))}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
