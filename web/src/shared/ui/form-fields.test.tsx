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

describe("shared form fields", () => {
  it("uses a single subtle focus line for inputs", () => {
    render(<Input aria-label="Display name" />);

    expectSingleSubtleFocusLine(screen.getByRole("textbox", { name: "Display name" }));
  });

  it("uses a single subtle focus line for textareas", () => {
    render(<Textarea aria-label="Message" />);

    expectSingleSubtleFocusLine(screen.getByRole("textbox", { name: "Message" }));
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
});
