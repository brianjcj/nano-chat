import { Outlet } from "react-router";

import { useRealtimeBridge } from "@/shared/realtime/useRealtimeBridge";

export function AuthenticatedAppLayout() {
  useRealtimeBridge();

  return <Outlet />;
}
