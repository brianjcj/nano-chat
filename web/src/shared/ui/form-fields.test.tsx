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
});
