import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the Nano Chat web application shell marker", () => {
    render(<App />);
    expect(screen.getByText("Nano Chat")).toBeInTheDocument();
  });
});
