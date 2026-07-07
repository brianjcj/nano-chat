import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("uses theme-aware surface chrome for secondary buttons", () => {
    render(<Button variant="secondary">Cancel</Button>);

    const button = screen.getByRole("button", { name: "Cancel" });

    expect(button).toHaveClass(
      "border-[color-mix(in_oklab,var(--surface)_72%,var(--border))]",
      "bg-[color-mix(in_oklab,var(--surface)_76%,transparent)]",
      "hover:border-[color-mix(in_oklab,var(--primary)_28%,var(--border))]",
      "hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--surface))]",
    );
    expect(button).not.toHaveClass("bg-white/75");
  });
});
