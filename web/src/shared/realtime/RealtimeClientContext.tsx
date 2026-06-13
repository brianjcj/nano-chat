import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

import { getAppEnv } from "@/shared/config/env";
import { RealtimeClient } from "./realtimeClient";

const RealtimeClientContext = createContext<RealtimeClient | null>(null);

type RealtimeClientProviderProps = PropsWithChildren<{
  client?: RealtimeClient;
}>;

export function RealtimeClientProvider({
  children,
  client,
}: RealtimeClientProviderProps) {
  const wsUrl = useMemo(() => getAppEnv().wsUrl, []);
  const resolvedClient = useMemo(
    () => client ?? new RealtimeClient({ wsUrl }),
    [client, wsUrl],
  );

  return (
    <RealtimeClientContext.Provider value={resolvedClient}>
      {children}
    </RealtimeClientContext.Provider>
  );
}

export function useRealtimeClient() {
  const client = useContext(RealtimeClientContext);

  if (!client) {
    throw new Error("useRealtimeClient must be used inside RealtimeClientProvider.");
  }

  return client;
}

export function useOptionalRealtimeClient() {
  return useContext(RealtimeClientContext);
}
