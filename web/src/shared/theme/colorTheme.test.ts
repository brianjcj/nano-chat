import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLOR_THEME_CHANGE_EVENT,
  COLOR_THEME_STORAGE_KEY,
  applyColorTheme,
  initializeColorTheme,
  readStoredColorTheme,
  setColorTheme,
} from "./colorTheme";

describe("color theme", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to mist when no saved theme exists", () => {
    expect(readStoredColorTheme()).toBe("mist");
  });

  it("restores a valid saved theme", () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, "midnight");

    expect(readStoredColorTheme()).toBe("midnight");
  });

  it("ignores invalid saved theme values", () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, "neon");

    expect(readStoredColorTheme()).toBe("mist");
  });

  it("applies the selected theme to the html data attribute", () => {
    expect(applyColorTheme("sakura")).toBe("sakura");

    expect(document.documentElement).toHaveAttribute("data-theme", "sakura");
  });

  it("initializes the saved theme on the html data attribute", () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, "forest");

    expect(initializeColorTheme()).toBe("forest");

    expect(document.documentElement).toHaveAttribute("data-theme", "forest");
  });

  it("persists and broadcasts explicit theme selections", () => {
    const listener = vi.fn();
    window.addEventListener(COLOR_THEME_CHANGE_EVENT, listener);

    expect(setColorTheme("midnight")).toBe("midnight");

    expect(window.localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("midnight");
    expect(document.documentElement).toHaveAttribute("data-theme", "midnight");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      theme: "midnight",
    });

    window.removeEventListener(COLOR_THEME_CHANGE_EVENT, listener);
  });

  it("still applies a theme when localStorage writes are blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => setColorTheme("forest")).not.toThrow();

    expect(document.documentElement).toHaveAttribute("data-theme", "forest");
  });

  it("falls back to mist when localStorage reads are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => initializeColorTheme()).not.toThrow();

    expect(document.documentElement).toHaveAttribute("data-theme", "mist");
  });
});
