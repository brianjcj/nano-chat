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

  it("returns the same cool-ink gradient token and class for the same user id", () => {
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
    expect(first.gradientToken).toMatch(/^cool-ink-/);
    expect(first.gradientClassName).toContain("linear-gradient");
  });

  it("does not return legacy warm candy avatar names or colors", () => {
    const legacyPattern = /soft-social|#ff8a7a|#ffd0b0|#8a6dff|#f0abfc|#fed7aa|#f9a8d4|#fb7185|#fdba74|#fde68a|#fbcfe8|#fef08a|#fda4af/i;

    for (const userId of ["1001", "1002", "1003", "1004", "1005", "1006"]) {
      const visual = getAvatarVisual(user({ user_id: userId }));

      expect(visual.gradientToken).toMatch(/^cool-ink-/);
      expect(`${visual.gradientToken} ${visual.gradientClassName}`).not.toMatch(legacyPattern);
    }
  });
});
