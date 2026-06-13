import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  createFakeApiClient,
  makeAuthResponse,
  renderAppRoute,
  screen,
  waitFor,
} from "@/app/test-utils";
import { ApiError } from "@/shared/api/client";

const validSession = makeAuthResponse({
  username: "alice",
  displayName: "Alice",
});

describe("auth routes", () => {
  it("redirects unauthenticated /app/im requests to /login", async () => {
    const { router } = await renderAppRoute({ initialEntries: ["/app/im"] });

    expect(
      await screen.findByRole("heading", { name: "Sign in to Nano Chat" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("redirects authenticated /login requests to /app/im", async () => {
    const { router } = await renderAppRoute({
      initialEntries: ["/login"],
      session: validSession,
    });

    expect(await screen.findByText("Temporary IM shell")).toBeInTheDocument();
    expect(screen.getByText("Nano Chat")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/im");
  });

  it("logs in, stores the session, and navigates to /app/im", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(validSession);
    const apiClient = createFakeApiClient({ login });
    const { router, sessionStore } = await renderAppRoute({
      initialEntries: ["/login"],
      apiClient,
    });

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        username: "alice",
        password: "correct horse",
      });
    });
    expect(await screen.findByText("Temporary IM shell")).toBeInTheDocument();
    expect(sessionStore.getValidSession()).toEqual(validSession);
    expect(router.state.location.pathname).toBe("/app/im");
  });

  it("registers, omits a blank display name, stores the session, and navigates to /app/im", async () => {
    const user = userEvent.setup();
    const register = vi.fn().mockResolvedValue(validSession);
    const apiClient = createFakeApiClient({ register });
    const { router, sessionStore } = await renderAppRoute({
      initialEntries: ["/register"],
      apiClient,
    });

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith({
        username: "alice",
        password: "correct horse",
      });
    });
    expect(await screen.findByText("Temporary IM shell")).toBeInTheDocument();
    expect(sessionStore.getValidSession()).toEqual(validSession);
    expect(router.state.location.pathname).toBe("/app/im");
  });

  it("renders invalid credential errors inline with translated copy", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn()
      .mockRejectedValue(
        new ApiError("invalid_credentials", "Invalid credentials", 401),
      );
    const apiClient = createFakeApiClient({ login });
    const { router } = await renderAppRoute({
      initialEntries: ["/login"],
      apiClient,
    });

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The username or password is incorrect.");
    expect(router.state.location.pathname).toBe("/login");
  });
});
