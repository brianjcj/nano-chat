import { Outlet } from "react-router";

import { CallProvider } from "@/features/calls/CallProvider";
import { CallOverlay } from "@/features/calls/components/CallOverlay";
import { IncomingCallDialog } from "@/features/calls/components/IncomingCallDialog";
import { RealtimeClientProvider } from "@/shared/realtime/RealtimeClientContext";
import { useRealtimeBridge } from "@/shared/realtime/useRealtimeBridge";

export function AuthenticatedAppLayout() {
  return (
    <RealtimeClientProvider>
      <CallProvider>
        <RealtimeBridgeMount />
        <IncomingCallDialog />
        <CallOverlay />
        <Outlet />
      </CallProvider>
    </RealtimeClientProvider>
  );
}

function RealtimeBridgeMount() {
  useRealtimeBridge();

  return null;
}
