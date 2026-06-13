import {
  QueryClientProvider,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { i18n as I18nInstance } from "i18next";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { I18nextProvider } from "react-i18next";

import { queryClient as defaultQueryClient } from "./queryClient";
import { useImStore } from "@/features/im/state/imStore";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { getAppEnv } from "@/shared/config/env";
import {
  i18n as defaultI18n,
  i18nReady as defaultI18nReady,
} from "@/shared/i18n/i18n";
import {
  sessionStore as defaultSessionStore,
  type Session,
  type SessionStore,
} from "@/shared/session/sessionStore";

type AppProvidersProps = PropsWithChildren<{
  apiClient?: ApiClient;
  i18nInstance?: I18nInstance;
  queryClient?: QueryClient;
  sessionStore?: SessionStore;
}>;

type SessionContextValue = {
  session: Session | null;
  sessionStore: SessionStore;
  getValidSession: () => Session | null;
  saveSession: (session: Session) => void;
  clearSession: () => void;
};

const ApiClientContext = createContext<ApiClient | null>(null);
const SessionContext = createContext<SessionContextValue | null>(null);

export function AppProviders({
  apiClient,
  children,
  i18nInstance = defaultI18n,
  queryClient = defaultQueryClient,
  sessionStore = defaultSessionStore,
}: AppProvidersProps) {
  const isI18nReady = useI18nReady(i18nInstance);

  if (!isI18nReady) {
    return null;
  }

  return (
    <I18nextProvider i18n={i18nInstance}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider sessionStore={sessionStore}>
          <ApiClientProvider apiClient={apiClient}>{children}</ApiClientProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export function useApiClient() {
  const apiClient = useContext(ApiClientContext);

  if (!apiClient) {
    throw new Error("useApiClient must be used inside AppProviders.");
  }

  return apiClient;
}

export function useSession() {
  const sessionContext = useContext(SessionContext);

  if (!sessionContext) {
    throw new Error("useSession must be used inside AppProviders.");
  }

  return sessionContext;
}

function SessionProvider({
  children,
  sessionStore,
}: PropsWithChildren<{ sessionStore: SessionStore }>) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() =>
    sessionStore.getValidSession(),
  );

  const getValidSession = useCallback(() => {
    const storedSession = sessionStore.getValidSession();
    const currentSession = storedSession ?? session;

    return isSessionFresh(currentSession) ? currentSession : null;
  }, [session, sessionStore]);

  const resetSessionScopedClientState = useCallback(() => {
    queryClient.clear();
    useImStore.getState().reset();
  }, [queryClient]);

  const saveSession = useCallback(
    (nextSession: Session) => {
      const currentSession = sessionStore.getValidSession() ?? session;

      if (!isSameSessionIdentity(currentSession, nextSession)) {
        resetSessionScopedClientState();
      }

      sessionStore.save(nextSession);
      setSession(nextSession);
    },
    [resetSessionScopedClientState, session, sessionStore],
  );

  const clearSession = useCallback(() => {
    sessionStore.clear();
    resetSessionScopedClientState();
    setSession(null);
  }, [resetSessionScopedClientState, sessionStore]);

  const currentSession = getValidSession();
  const value = useMemo(
    () => ({
      session: currentSession,
      sessionStore,
      getValidSession,
      saveSession,
      clearSession,
    }),
    [clearSession, currentSession, getValidSession, saveSession, sessionStore],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

function ApiClientProvider({
  apiClient,
  children,
}: PropsWithChildren<{ apiClient?: ApiClient }>) {
  const { clearSession, getValidSession } = useSession();
  const { apiBaseUrl } = useMemo(() => getAppEnv(), []);
  const resolvedApiClient = useMemo(
    () =>
      apiClient ??
      createApiClient({
        baseUrl: apiBaseUrl,
        getAccessToken: () => getValidSession()?.access_token ?? null,
        onUnauthorized: clearSession,
      }),
    [apiBaseUrl, apiClient, clearSession, getValidSession],
  );

  return (
    <ApiClientContext.Provider value={resolvedApiClient}>
      {children}
    </ApiClientContext.Provider>
  );
}

function useI18nReady(i18nInstance: I18nInstance) {
  const [, forceReadyCheck] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (i18nInstance.isInitialized) {
      return () => {
        cancelled = true;
      };
    }

    const readiness =
      i18nInstance === defaultI18n
        ? defaultI18nReady
        : Promise.resolve(i18nInstance);

    void readiness.then(() => {
      if (!cancelled) {
        forceReadyCheck((version) => version + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [i18nInstance]);

  return i18nInstance.isInitialized;
}

function isSessionFresh(session: Session | null) {
  if (!session) {
    return false;
  }

  const expiresAtMs = Date.parse(session.expires_at);

  return !Number.isNaN(expiresAtMs) && expiresAtMs > Date.now();
}

function isSameSessionIdentity(
  currentSession: Session | null,
  nextSession: Session,
) {
  if (!currentSession) {
    return false;
  }

  return (
    currentSession.user.user_id === nextSession.user.user_id &&
    currentSession.client_id === nextSession.client_id
  );
}
