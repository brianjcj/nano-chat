import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

const styles = readFileSync("src/styles.css", "utf8");

function expectSingleSubtleFocusLine(element: HTMLElement) {
  const className = element.getAttribute("class") ?? "";

  expect(className).not.toContain("focus-visible:ring-");
  expect(className).not.toContain("focus:ring-");
  expect(className).not.toContain("focus-visible:ring-offset");
  expect(className).not.toContain("focus:ring-offset");
  expect(className).not.toContain("focus-visible:shadow-");
  expect(className).not.toContain("focus:shadow-");
  expect(className).toContain("focus:border-[color-mix(in_oklab,var(--ring)_36%,var(--border))]");
  expect(className).toContain("focus:outline-none");
}

function expectThemeAwareSurfaceBackground(element: HTMLElement) {
  const className = element.getAttribute("class") ?? "";

  expect(className).toContain("bg-[color-mix(in_oklab,var(--surface)_80%,transparent)]");
  expect(className).toContain("focus:bg-[var(--surface)]");
  expect(className).not.toContain("bg-white/80");
  expect(className).not.toContain("focus:bg-white");
}

describe("shared form fields", () => {
  it("uses a single subtle focus line and theme-aware surface background for inputs", () => {
    render(<Input aria-label="Display name" />);

    const input = screen.getByRole("textbox", { name: "Display name" });
    expectSingleSubtleFocusLine(input);
    expectThemeAwareSurfaceBackground(input);
  });

  it("uses a single subtle focus line and theme-aware surface background for textareas", () => {
    render(<Textarea aria-label="Message" />);

    const textarea = screen.getByRole("textbox", { name: "Message" });
    expectSingleSubtleFocusLine(textarea);
    expectThemeAwareSurfaceBackground(textarea);
  });

  it("opts form fields out of the global thick focus outline", () => {
    expect(styles).toContain("input:focus,\ntextarea:focus");
    expect(styles).toContain("outline: none;");
  });

  it("defines the quiet ink-blue mist theme tokens", () => {
    expect(styles).toContain("--background: #edf4f7;");
    expect(styles).toContain("--foreground: #12232d;");
    expect(styles).toContain("--surface-muted: #f5f9fb;");
    expect(styles).toContain("--primary: #0f9f8f;");
    expect(styles).toContain("--accent: #315c7c;");
    expect(styles).toContain("--bubble-outgoing: #d8f4ee;");
    expect(styles).toContain("--border: #d3e1e8;");
    expect(styles).not.toContain("--background: #fff8f1;");
    expect(styles).not.toContain("--primary: #ff715f;");
    expect(styles).not.toContain("--accent: #8a6dff;");
  });

  it("defines selectable color theme tokens", () => {
    expect(styles).toContain('html[data-theme="mist"]');
    expect(styles).toContain('html[data-theme="midnight"]');
    expect(styles).toContain('html[data-theme="sakura"]');
    expect(styles).toContain('html[data-theme="forest"]');
    expect(styles).toContain("--background: #0d1620;");
    expect(styles).toContain("--primary: #38cdbd;");
    expect(styles).toContain("--background: #fff1f5;");
    expect(styles).toContain("--primary: #d94d7b;");
    expect(styles).toContain("--background: #eef7ee;");
    expect(styles).toContain("--primary: #2f9b61;");
    expect(styles).toContain("--background-gradient-start:");
    expect(styles).toContain("--background-glow-primary:");
  });

  it("uses theme-aware text selection colors with a dark-theme contrast override", () => {
    expect(styles).toContain(
      "--selection-background: color-mix(in oklab, var(--primary) 30%, white);",
    );
    expect(styles).toContain("--selection-foreground: var(--foreground);");
    expect(styles).toContain("--selection-background: var(--primary);");
    expect(styles).toContain("--selection-foreground: var(--primary-foreground);");
    expect(styles).toContain(
      "::selection {\n  background: var(--selection-background);\n  color: var(--selection-foreground);\n}",
    );
    expect(styles).not.toContain(
      "::selection {\n  background: color-mix(in oklab, var(--primary) 30%, white);\n  color: var(--foreground);\n}",
    );
  });
});
