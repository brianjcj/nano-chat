import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { RouterProvider } from "react-router";

import { AppProviders } from "./AppProviders";
import { createQueryClient } from "./queryClient";
import { createAppMemoryRouter } from "./router";
import type { ApiClient } from "@/shared/api/client";
import type { AuthResponse } from "@/shared/api/types";
import { createAppI18n } from "@/shared/i18n/i18n";
import type { Session, SessionStore } from "@/shared/session/sessionStore";

type RenderWithProvidersOptions = Omit<RenderOptions, "wrapper"> & {
  queryClient?: QueryClient;
};

export function renderWithProviders(
  ui: ReactElement,
  {
    queryClient = createQueryClient(),
    ...renderOptions
  }: RenderWithProvidersOptions = {},
) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}

type RenderAppRouteOptions = {
  initialEntries?: string[];
  session?: Session | null;
  apiClient?: ApiClient;
  queryClient?: QueryClient;
};

export async function renderAppRoute({
  initialEntries = ["/"],
  session = null,
  apiClient = createFakeApiClient(),
  queryClient = createQueryClient(),
}: RenderAppRouteOptions = {}) {
  const sessionStore = createMemorySessionStore(session);
  const i18nInstance = await createAppI18n({
    language: "en-US",
    useLanguageDetector: false,
  });
  const router = createAppMemoryRouter({ initialEntries });

  return {
    router,
    queryClient,
    sessionStore,
    i18n: i18nInstance,
    ...render(
      <AppProviders
        apiClient={apiClient}
        i18nInstance={i18nInstance}
        queryClient={queryClient}
        sessionStore={sessionStore}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}

export function createMemorySessionStore(
  initialSession: Session | null = null,
): SessionStore {
  let currentSession = initialSession;

  return {
    save(session) {
      currentSession = session;
    },
    load() {
      return validOrNull(currentSession);
    },
    getValidSession() {
      return validOrNull(currentSession);
    },
    clear() {
      currentSession = null;
    },
  };
}

export function makeAuthResponse({
  userId = "1001",
  username = "alice",
  displayName = "Alice",
  clientId = "client-1",
  accessToken = "access-token-1",
  expiresAt = "2999-01-01T00:00:00.000Z",
}: {
  userId?: string;
  username?: string;
  displayName?: string | null;
  clientId?: string;
  accessToken?: string;
  expiresAt?: string;
} = {}): AuthResponse {
  return {
    user: {
      user_id: userId,
      username,
      display_name: displayName,
    },
    client_id: clientId,
    access_token: accessToken,
    expires_at: expiresAt,
  };
}

export function createFakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    register: notConfigured("register"),
    login: notConfigured("login"),
    getMe: notConfigured("getMe"),
    patchMe: notConfigured("patchMe"),
    lookupUser: notConfigured("lookupUser"),
    listConversations: notConfigured("listConversations"),
    createGroup: notConfigured("createGroup"),
    listMembers: notConfigured("listMembers"),
    addMember: notConfigured("addMember"),
    leaveGroup: notConfigured("leaveGroup"),
    listMessages: notConfigured("listMessages"),
    getIceServers: notConfigured("getIceServers"),
    ...overrides,
  };
}

function validOrNull(session: Session | null) {
  if (!session) {
    return null;
  }

  const expiresAtMs = Date.parse(session.expires_at);

  return !Number.isNaN(expiresAtMs) && expiresAtMs > Date.now()
    ? session
    : null;
}

function notConfigured<T>(methodName: string) {
  return (async () => {
    throw new Error(`Fake API method ${methodName} was not configured.`);
  }) as () => Promise<T>;
}

export * from "@testing-library/react";
