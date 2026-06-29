import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppProviders, useSession } from "./AppProviders";
import { createQueryClient } from "./queryClient";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { createAppI18n } from "@/shared/i18n/i18n";
import type { Session, SessionStore } from "@/shared/session/sessionStore";

function QueryClientProbe({ expectedClient }: { expectedClient: unknown }) {
  const queryClient = useQueryClient();

  return (
    <span data-testid="query-client-probe">
      {queryClient === expectedClient ? "available" : "missing"}
    </span>
  );
}

function ClearSessionProbe() {
  const { clearSession } = useSession();

  return (
    <button onClick={clearSession} type="button">
      Clear session
    </button>
  );
}

function SaveSessionProbe({ nextSession }: { nextSession: Session }) {
  const { saveSession } = useSession();

  return (
    <button onClick={() => saveSession(nextSession)} type="button">
      Save session
    </button>
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

  it("clears Query cache when clearSession is invoked from the session provider", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const sessionStore = createMemorySessionStore(makeSession());
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });
    queryClient.setQueryData(imQueryKeys.conversations(), [
      "cached-conversation",
    ]);

    render(
      <AppProviders
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={sessionStore}
      >
        <ClearSessionProbe />
      </AppProviders>,
    );

    expect(queryClient.getQueryData(imQueryKeys.conversations())).toEqual([
      "cached-conversation",
    ]);

    await user.click(screen.getByRole("button", { name: "Clear session" }));

    expect(
      queryClient.getQueryData(imQueryKeys.conversations()),
    ).toBeUndefined();
  });

  it("clears previous Query cache before saving a different user session", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const initialSession = makeSession();
    const nextSession = makeSession({
      accessToken: "access-token-2",
      clientId: "client-2",
      userId: "1002",
      username: "bob",
    });
    const sessionStore = createMemorySessionStore(initialSession);
    const i18nInstance = await createAppI18n({
      language: "en-US",
      useLanguageDetector: false,
    });
    queryClient.setQueryData(imQueryKeys.conversations(), [
      "cached-conversation",
    ]);

    render(
      <AppProviders
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={sessionStore}
      >
        <SaveSessionProbe nextSession={nextSession} />
      </AppProviders>,
    );

    await user.click(screen.getByRole("button", { name: "Save session" }));

    expect(
      queryClient.getQueryData(imQueryKeys.conversations()),
    ).toBeUndefined();
    expect(sessionStore.getValidSession()).toEqual(nextSession);
  });
});

function createMemorySessionStore(
  initialSession: Session | null = null,
): SessionStore {
  let currentSession = initialSession;

  return {
    save(session) {
      currentSession = session;
    },
    load() {
      return currentSession;
    },
    getValidSession() {
      return currentSession;
    },
    clear() {
      currentSession = null;
    },
  };
}

function makeSession({
  accessToken = "access-token-1",
  clientId = "client-1",
  displayName = "Alice",
  expiresAt = "2999-01-01T00:00:00.000Z",
  userId = "1001",
  username = "alice",
}: {
  accessToken?: string;
  clientId?: string;
  displayName?: string | null;
  expiresAt?: string;
  userId?: string;
  username?: string;
} = {}): Session {
  return {
    access_token: accessToken,
    client_id: clientId,
    expires_at: expiresAt,
    user: {
      display_name: displayName,
      user_id: userId,
      username,
    },
  };
}
