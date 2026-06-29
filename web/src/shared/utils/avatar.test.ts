import { describe, expect, it } from "vitest";

import { getAvatarInitials, getAvatarVisual } from "./avatar";
import type { UserSummary } from "@/shared/api/types";

function user(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    user_id: "1001",
    username: "alice_wonder",
    display_name: "Alice Wonder",
    ...overrides,
  };
}

describe("avatar helpers", () => {
  it("derives stable initials from display name before username", () => {
    expect(getAvatarInitials(user({ display_name: "Ada Lovelace" }))).toBe("AL");
    expect(getAvatarInitials(user({ display_name: null, username: "grace_hopper" }))).toBe("GH");
  });

  it("returns the same soft-social gradient token and class for the same user id", () => {
    const first = getAvatarVisual(user({ user_id: "1001" }));
    const second = getAvatarVisual(
      user({
        user_id: "1001",
        username: "renamed_user",
        display_name: "Renamed User",
      }),
    );

    expect(second.gradientToken).toBe(first.gradientToken);
    expect(second.gradientClassName).toBe(first.gradientClassName);
    expect(first.gradientToken).toMatch(/^soft-social-/);
  });
});
