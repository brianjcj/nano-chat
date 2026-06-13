import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppProviders } from "./AppProviders";
import { createQueryClient } from "./queryClient";

function QueryClientProbe({ expectedClient }: { expectedClient: unknown }) {
  const queryClient = useQueryClient();

  return (
    <span data-testid="query-client-probe">
      {queryClient === expectedClient ? "available" : "missing"}
    </span>
  );
}

describe("AppProviders", () => {
  it("makes a QueryClient available to app children", () => {
    const queryClient = createQueryClient();

    render(
      <AppProviders queryClient={queryClient}>
        <QueryClientProbe expectedClient={queryClient} />
      </AppProviders>,
    );

    expect(screen.getByTestId("query-client-probe")).toHaveTextContent(
      "available",
    );
  });
});
