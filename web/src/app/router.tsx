import type { ReactNode } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
  useLocation,
} from "react-router";

import { useSession } from "./AppProviders";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { AppShellPlaceholder } from "@/features/shell/AppShellPlaceholder";
import { AuthenticatedAppLayout } from "@/features/shell/AuthenticatedAppLayout";

type CreateAppMemoryRouterOptions = {
  initialEntries?: string[];
};

export function createAppRouter() {
  return createBrowserRouter(createAppRoutes());
}

export function createAppMemoryRouter({
  initialEntries = ["/"],
}: CreateAppMemoryRouterOptions = {}) {
  return createMemoryRouter(createAppRoutes(), { initialEntries });
}

function createAppRoutes(): RouteObject[] {
  return [
    {
      path: "/",
      element: <FallbackRedirect />,
    },
    {
      path: "/login",
      element: (
        <GuestRoute>
          <AuthLayout>
            <LoginPage />
          </AuthLayout>
        </GuestRoute>
      ),
    },
    {
      path: "/register",
      element: (
        <GuestRoute>
          <AuthLayout>
            <RegisterPage />
          </AuthLayout>
        </GuestRoute>
      ),
    },
    {
      path: "/app",
      element: (
        <ProtectedRoute>
          <AuthenticatedAppLayout />
        </ProtectedRoute>
      ),
      children: [
        {
          index: true,
          element: <Navigate replace to="/app/im" />,
        },
        {
          path: "im",
          element: <AppShellPlaceholder />,
        },
        {
          path: "im/conversations/:conversationId",
          element: <AppShellPlaceholder />,
        },
        {
          path: "*",
          element: <Navigate replace to="/app/im" />,
        },
      ],
    },
    {
      path: "*",
      element: <FallbackRedirect />,
    },
  ];
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { getValidSession } = useSession();

  if (!getValidSession()) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  return <>{children}</>;
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { getValidSession } = useSession();

  if (getValidSession()) {
    return <Navigate replace to="/app/im" />;
  }

  return <>{children}</>;
}

function FallbackRedirect() {
  const { getValidSession } = useSession();

  return <Navigate replace to={getValidSession() ? "/app/im" : "/login"} />;
}
