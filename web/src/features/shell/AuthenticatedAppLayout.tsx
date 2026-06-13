import { Outlet } from "react-router";

import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import { useRealtimeBridge } from "@/shared/realtime/useRealtimeBridge";

export function AuthenticatedAppLayout() {
  return (
    <RealtimeClientProvider>
      <RealtimeBridgeMount />
      <Outlet />
    </RealtimeClientProvider>
  );
}

function RealtimeBridgeMount() {
  useRealtimeBridge();

  return null;
}
