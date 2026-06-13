import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppProviders } from "./AppProviders";
import { createQueryClient } from "./queryClient";
import { createAppI18n } from "@/shared/i18n/i18n";

function QueryClientProbe({ expectedClient }: { expectedClient: unknown }) {
  const queryClient = useQueryClient();

  return (
    <span data-testid="query-client-probe">
      {queryClient === expectedClient ? "available" : "missing"}
    </span>
  );
}

describe("AppProviders", () => {
  it("makes a QueryClient available to app children", async () => {
    const queryClient = createQueryClient();
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });

    render(
      <AppProviders i18nInstance={i18nInstance} queryClient={queryClient}>
        <QueryClientProbe expectedClient={queryClient} />
      </AppProviders>,
    );

    expect(screen.getByTestId("query-client-probe")).toHaveTextContent(
      "available",
    );
  });
});
