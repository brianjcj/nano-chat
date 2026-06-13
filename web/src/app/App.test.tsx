import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { AppProviders } from "./AppProviders";
import { createMemorySessionStore } from "./test-utils";
import { createAppI18n } from "@/shared/i18n/i18n";

describe("App", () => {
  it("renders the unauthenticated app entry route", async () => {
    window.history.pushState({}, "", "/");
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });

    render(
      <AppProviders
        i18nInstance={i18nInstance}
        sessionStore={createMemorySessionStore()}
      >
        <App />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign in to Nano Chat" }),
    ).toBeInTheDocument();
  });
});
