# Web Color Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mist, Midnight, Sakura, and Forest color theme switching to the Nano Chat Web UI from the existing Settings menu.

**Architecture:** Use CSS variables as the theme boundary. A shared theme module validates, persists, applies, and broadcasts color theme changes through `<html data-theme="...">`; React UI reads it through a small hook. `web/src/styles.css` owns theme tokens, while the Settings menu only renders localized options and calls the hook.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 arbitrary value classes, Zustand, Vitest, Testing Library, i18next.

## Global Constraints

- Theme set is fixed to `mist`, `midnight`, `sakura`, and `forest`.
- `mist` is the default and preserves the current quiet ink-blue / mist / teal palette.
- Selected theme is persisted in browser `localStorage` under `nano-chat:color-theme`.
- Invalid or inaccessible stored values fall back to `mist` without crashing.
- Theme applies by setting `document.documentElement.dataset.theme`.
- Theme switching must not change routing, API, realtime, auth, or IM store behavior.
- Theme labels are localized in Chinese and English.
- Use test-first implementation for behavior changes.
- Run commands from `web/` unless the command explicitly says otherwise.

---

## File Structure

- Create `web/src/shared/theme/colorTheme.ts`: owns theme constants, type guards, localStorage persistence, DOM application, and a browser event for cross-component synchronization.
- Create `web/src/shared/theme/useColorTheme.ts`: React hook for Settings UI state and theme selection.
- Create `web/src/shared/theme/colorTheme.test.ts`: focused tests for persistence, validation, DOM application, and storage failure behavior.
- Modify `web/src/styles.css`: define theme tokens for Mist, Midnight, Sakura, and Forest; switch body atmosphere to token-backed gradients; add Midnight overrides for high-opacity hardcoded white utility surfaces.
- Modify `web/src/shared/ui/form-fields.test.tsx`: add a source-level theme CSS contract test.
- Modify `web/src/features/shell/ShellSettingsMenu.tsx`: add localized color theme choices to the existing Settings menu.
- Modify `web/src/features/shell/AppShell.test.tsx`: cover selecting a color theme from Settings.
- Modify `web/src/shared/i18n/resources.ts`: add Chinese and English Settings labels for theme choices.
- Modify `web/src/main.tsx`: apply the saved theme before React mounts.

---

### Task 1: Add shared color theme domain and persistence

**Files:**
- Create: `web/src/shared/theme/colorTheme.test.ts`
- Create: `web/src/shared/theme/colorTheme.ts`
- Create: `web/src/shared/theme/useColorTheme.ts`

**Interfaces:**
- Consumes: browser `localStorage`, `document.documentElement.dataset.theme`, `window` events.
- Produces:
  - `COLOR_THEMES: readonly ["mist", "midnight", "sakura", "forest"]`
  - `type ColorTheme = "mist" | "midnight" | "sakura" | "forest"`
  - `DEFAULT_COLOR_THEME: ColorTheme`
  - `COLOR_THEME_STORAGE_KEY = "nano-chat:color-theme"`
  - `COLOR_THEME_CHANGE_EVENT = "nano-chat:color-theme-change"`
  - `isColorTheme(value: unknown): value is ColorTheme`
  - `readStoredColorTheme(): ColorTheme`
  - `applyColorTheme(theme: ColorTheme): ColorTheme`
  - `initializeColorTheme(): ColorTheme`
  - `setColorTheme(theme: ColorTheme): ColorTheme`
  - `subscribeColorThemeChange(listener: (theme: ColorTheme) => void): () => void`
  - `useColorTheme(): { theme: ColorTheme; setTheme: (theme: ColorTheme) => void }`

- [ ] **Step 1: Write the failing theme module tests**

Create `web/src/shared/theme/colorTheme.test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test -- src/shared/theme/colorTheme.test.ts
```

Expected: FAIL because `src/shared/theme/colorTheme.ts` does not exist yet.

- [ ] **Step 3: Implement the theme module**

Create `web/src/shared/theme/colorTheme.ts` with this content:

```ts
export const COLOR_THEMES = [
  "mist",
  "midnight",
  "sakura",
  "forest",
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];

export const DEFAULT_COLOR_THEME: ColorTheme = "mist";
export const COLOR_THEME_STORAGE_KEY = "nano-chat:color-theme";
export const COLOR_THEME_CHANGE_EVENT = "nano-chat:color-theme-change";

type ColorThemeChangeDetail = {
  theme: ColorTheme;
};

export function isColorTheme(value: unknown): value is ColorTheme {
  return COLOR_THEMES.includes(value as ColorTheme);
}

export function readStoredColorTheme(): ColorTheme {
  try {
    const storedTheme = globalThis.localStorage?.getItem(
      COLOR_THEME_STORAGE_KEY,
    );

    return isColorTheme(storedTheme) ? storedTheme : DEFAULT_COLOR_THEME;
  } catch {
    return DEFAULT_COLOR_THEME;
  }
}

export function applyColorTheme(theme: ColorTheme): ColorTheme {
  if (typeof globalThis.document !== "undefined") {
    globalThis.document.documentElement.dataset.theme = theme;
  }

  return theme;
}

export function initializeColorTheme(): ColorTheme {
  return applyColorTheme(readStoredColorTheme());
}

export function setColorTheme(theme: ColorTheme): ColorTheme {
  writeStoredColorTheme(theme);
  applyColorTheme(theme);
  dispatchColorThemeChange(theme);

  return theme;
}

export function subscribeColorThemeChange(
  listener: (theme: ColorTheme) => void,
) {
  if (typeof globalThis.window === "undefined") {
    return () => undefined;
  }

  function handleColorThemeChange(event: Event) {
    const detail = (event as CustomEvent<ColorThemeChangeDetail>).detail;

    if (isColorTheme(detail?.theme)) {
      listener(detail.theme);
    }
  }

  globalThis.window.addEventListener(
    COLOR_THEME_CHANGE_EVENT,
    handleColorThemeChange,
  );

  return () => {
    globalThis.window.removeEventListener(
      COLOR_THEME_CHANGE_EVENT,
      handleColorThemeChange,
    );
  };
}

function writeStoredColorTheme(theme: ColorTheme) {
  try {
    globalThis.localStorage?.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is best-effort when storage is unavailable.
  }
}

function dispatchColorThemeChange(theme: ColorTheme) {
  if (typeof globalThis.window === "undefined") {
    return;
  }

  globalThis.window.dispatchEvent(
    new CustomEvent<ColorThemeChangeDetail>(COLOR_THEME_CHANGE_EVENT, {
      detail: { theme },
    }),
  );
}
```

- [ ] **Step 4: Implement the React hook**

Create `web/src/shared/theme/useColorTheme.ts` with this content:

```ts
import { useCallback, useEffect, useState } from "react";

import {
  initializeColorTheme,
  setColorTheme,
  subscribeColorThemeChange,
  type ColorTheme,
} from "./colorTheme";

export function useColorTheme() {
  const [theme, setThemeState] = useState<ColorTheme>(() =>
    initializeColorTheme(),
  );

  useEffect(() => subscribeColorThemeChange(setThemeState), []);

  const selectTheme = useCallback((nextTheme: ColorTheme) => {
    setThemeState(setColorTheme(nextTheme));
  }, []);

  return {
    theme,
    setTheme: selectTheme,
  };
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm test -- src/shared/theme/colorTheme.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the theme module**

Run from the repository root:

```bash
git add web/src/shared/theme/colorTheme.test.ts web/src/shared/theme/colorTheme.ts web/src/shared/theme/useColorTheme.ts
git commit -m "feat: add color theme persistence"
```

---

### Task 2: Add CSS theme tokens and visual contract tests

**Files:**
- Modify: `web/src/shared/ui/form-fields.test.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: the `styles` source string already read from `src/styles.css` in `form-fields.test.tsx`.
- Produces: token definitions for `mist`, `midnight`, `sakura`, and `forest` through CSS variables on `:root` and `html[data-theme="..."]`.

- [ ] **Step 1: Add the failing CSS theme contract test**

Append this test inside the existing `describe("shared form fields", () => { ... })` block in `web/src/shared/ui/form-fields.test.tsx`, after the existing `defines the quiet ink-blue mist theme tokens` test:

```tsx
  it("defines selectable color theme tokens", () => {
    expect(styles).toContain('html[data-theme="mist"]');
    expect(styles).toContain('html[data-theme="midnight"]');
    expect(styles).toContain('html[data-theme="sakura"]');
    expect(styles).toContain('html[data-theme="forest"]');
    expect(styles).toContain("--background: #0d1620;");
    expect(styles).toContain("--primary: #38cdbd;");
    expect(styles).toContain("--background: #fff1f5;");
    expect(styles).toContain("--primary: #d94d7b;");
    expect(styles).toContain("--background: #eef7ee;");
    expect(styles).toContain("--primary: #2f9b61;");
    expect(styles).toContain("--background-gradient-start:");
    expect(styles).toContain("--background-glow-primary:");
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test -- src/shared/ui/form-fields.test.tsx
```

Expected: FAIL because `html[data-theme="midnight"]`, `html[data-theme="sakura"]`, and `html[data-theme="forest"]` token blocks do not exist yet.

- [ ] **Step 3: Replace `web/src/styles.css` with theme-aware tokens**

Replace the full contents of `web/src/styles.css` with this content:

```css
@import "tailwindcss";

:root,
html[data-theme="mist"] {
  color-scheme: light;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;

  --background: #edf4f7;
  --foreground: #12232d;
  --surface: #ffffff;
  --surface-muted: #f5f9fb;
  --muted: #dbe8ee;
  --muted-foreground: #5d7180;
  --primary: #0f9f8f;
  --primary-foreground: #ffffff;
  --primary-shadow: rgb(15 159 143 / 22%);
  --accent: #315c7c;
  --accent-foreground: #ffffff;
  --bubble-outgoing: #d8f4ee;
  --bubble-incoming: #ffffff;
  --border: #d3e1e8;
  --ring: #54c3b4;
  --destructive: #c8465a;
  --destructive-foreground: #ffffff;
  --shadow-color: rgb(18 35 45 / 10%);
  --background-gradient-start: #edf4f7;
  --background-gradient-mid: #f8fbfc;
  --background-gradient-end: #e8f1f5;
  --background-glow-primary: rgb(84 195 180 / 20%);
  --background-glow-accent: rgb(49 92 124 / 14%);
  --shell-chrome-start: #12232d;
  --shell-chrome-end: #173446;
  --shell-chrome-border: color-mix(in oklab, var(--primary) 26%, var(--foreground));
  --shell-chrome-shadow: rgb(18 35 45 / 24%);
  --radius: 1rem;
}

html[data-theme="midnight"] {
  color-scheme: dark;

  --background: #0d1620;
  --foreground: #edf7f5;
  --surface: #162331;
  --surface-muted: #101b26;
  --muted: #263849;
  --muted-foreground: #9fb3c3;
  --primary: #38cdbd;
  --primary-foreground: #06201d;
  --primary-shadow: rgb(56 205 189 / 26%);
  --accent: #8bb8ff;
  --accent-foreground: #07111d;
  --bubble-outgoing: #173f3d;
  --bubble-incoming: #1b2a39;
  --border: #294052;
  --ring: #55d6c9;
  --destructive: #ff6b86;
  --destructive-foreground: #1c050b;
  --shadow-color: rgb(0 0 0 / 34%);
  --background-gradient-start: #0d1620;
  --background-gradient-mid: #101c28;
  --background-gradient-end: #071019;
  --background-glow-primary: rgb(56 205 189 / 18%);
  --background-glow-accent: rgb(139 184 255 / 12%);
  --shell-chrome-start: #071019;
  --shell-chrome-end: #0f2435;
  --shell-chrome-border: color-mix(in oklab, var(--primary) 28%, #071019);
  --shell-chrome-shadow: rgb(0 0 0 / 34%);
}

html[data-theme="sakura"] {
  color-scheme: light;

  --background: #fff1f5;
  --foreground: #34212a;
  --surface: #ffffff;
  --surface-muted: #fff7fa;
  --muted: #f4dce5;
  --muted-foreground: #7e5b68;
  --primary: #d94d7b;
  --primary-foreground: #ffffff;
  --primary-shadow: rgb(217 77 123 / 22%);
  --accent: #8f5ac2;
  --accent-foreground: #ffffff;
  --bubble-outgoing: #ffe1ec;
  --bubble-incoming: #ffffff;
  --border: #edcfda;
  --ring: #f18cac;
  --destructive: #c8465a;
  --destructive-foreground: #ffffff;
  --shadow-color: rgb(74 33 48 / 10%);
  --background-gradient-start: #fff1f5;
  --background-gradient-mid: #fff8fb;
  --background-gradient-end: #f8e8ff;
  --background-glow-primary: rgb(217 77 123 / 18%);
  --background-glow-accent: rgb(143 90 194 / 12%);
  --shell-chrome-start: #4b2635;
  --shell-chrome-end: #743653;
  --shell-chrome-border: color-mix(in oklab, var(--primary) 28%, #4b2635);
  --shell-chrome-shadow: rgb(74 33 48 / 24%);
}

html[data-theme="forest"] {
  color-scheme: light;

  --background: #eef7ee;
  --foreground: #173021;
  --surface: #ffffff;
  --surface-muted: #f6fbf5;
  --muted: #d9ebd8;
  --muted-foreground: #5e755f;
  --primary: #2f9b61;
  --primary-foreground: #ffffff;
  --primary-shadow: rgb(47 155 97 / 22%);
  --accent: #3c6f4b;
  --accent-foreground: #ffffff;
  --bubble-outgoing: #dcf4e4;
  --bubble-incoming: #ffffff;
  --border: #cee1cd;
  --ring: #67bd82;
  --destructive: #b94b59;
  --destructive-foreground: #ffffff;
  --shadow-color: rgb(23 48 33 / 10%);
  --background-gradient-start: #eef7ee;
  --background-gradient-mid: #fbf8ed;
  --background-gradient-end: #e2f1df;
  --background-glow-primary: rgb(47 155 97 / 18%);
  --background-glow-accent: rgb(60 111 75 / 12%);
  --shell-chrome-start: #173021;
  --shell-chrome-end: #244832;
  --shell-chrome-border: color-mix(in oklab, var(--primary) 28%, #173021);
  --shell-chrome-shadow: rgb(23 48 33 / 24%);
}

* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  min-height: 100%;
  background: var(--background);
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 18% 12%, var(--background-glow-primary), transparent 28rem),
    radial-gradient(circle at 88% 4%, var(--background-glow-accent), transparent 30rem),
    linear-gradient(135deg, var(--background-gradient-start) 0%, var(--background-gradient-mid) 48%, var(--background-gradient-end) 100%);
  color: var(--foreground);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled,
input:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

::selection {
  background: color-mix(in oklab, var(--primary) 30%, white);
  color: var(--foreground);
}

:focus-visible {
  outline: 3px solid color-mix(in oklab, var(--ring) 76%, white);
  outline-offset: 3px;
}

input:focus,
textarea:focus {
  outline: none;
}

html[data-theme="midnight"] .bg-white {
  background-color: var(--surface);
}

html[data-theme="midnight"] .bg-white\/44 {
  background-color: color-mix(in oklab, var(--surface) 44%, transparent);
}

html[data-theme="midnight"] .bg-white\/50 {
  background-color: color-mix(in oklab, var(--surface) 50%, transparent);
}

html[data-theme="midnight"] .bg-white\/54 {
  background-color: color-mix(in oklab, var(--surface) 54%, transparent);
}

html[data-theme="midnight"] .bg-white\/58 {
  background-color: color-mix(in oklab, var(--surface) 58%, transparent);
}

html[data-theme="midnight"] .bg-white\/62 {
  background-color: color-mix(in oklab, var(--surface) 62%, transparent);
}

html[data-theme="midnight"] .bg-white\/70 {
  background-color: color-mix(in oklab, var(--surface) 70%, transparent);
}

html[data-theme="midnight"] .bg-white\/72 {
  background-color: color-mix(in oklab, var(--surface) 72%, transparent);
}

html[data-theme="midnight"] .bg-white\/76 {
  background-color: color-mix(in oklab, var(--surface) 76%, transparent);
}

html[data-theme="midnight"] .bg-white\/78 {
  background-color: color-mix(in oklab, var(--surface) 78%, transparent);
}

html[data-theme="midnight"] .bg-white\/88 {
  background-color: color-mix(in oklab, var(--surface) 88%, transparent);
}

html[data-theme="midnight"] .bg-white\/94 {
  background-color: color-mix(in oklab, var(--surface) 94%, transparent);
}

html[data-theme="midnight"] .bg-white\/95 {
  background-color: color-mix(in oklab, var(--surface) 95%, transparent);
}

html[data-theme="midnight"] .border-white\/70,
html[data-theme="midnight"] .border-white\/72,
html[data-theme="midnight"] .border-white\/74,
html[data-theme="midnight"] .border-white\/78 {
  border-color: color-mix(in oklab, var(--border) 78%, transparent);
}

html[data-theme="midnight"] .ring-white\/70,
html[data-theme="midnight"] .ring-white\/80 {
  --tw-ring-color: color-mix(in oklab, var(--border) 80%, transparent);
}

html[data-theme="midnight"] .hover\:bg-white:hover {
  background-color: var(--surface);
}

#root {
  min-height: 100vh;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm test -- src/shared/ui/form-fields.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the CSS themes**

Run from the repository root:

```bash
git add web/src/shared/ui/form-fields.test.tsx web/src/styles.css
git commit -m "style: add web color theme tokens"
```

---

### Task 3: Wire theme switching into startup and Settings

**Files:**
- Modify: `web/src/features/shell/AppShell.test.tsx`
- Modify: `web/src/shared/i18n/resources.ts`
- Modify: `web/src/features/shell/ShellSettingsMenu.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes from Task 1: `COLOR_THEMES`, `COLOR_THEME_STORAGE_KEY`, `type ColorTheme`, `initializeColorTheme()`, `useColorTheme()`.
- Produces: Settings menu buttons with accessible names `Mist`, `Midnight`, `Sakura`, `Forest` in English and localized Chinese labels in Chinese UI.

- [ ] **Step 1: Add the failing Settings integration test**

In `web/src/features/shell/AppShell.test.tsx`, add this import after the existing `useImStore` import:

```ts
import { COLOR_THEME_STORAGE_KEY } from "@/shared/theme/colorTheme";
```

Update the existing `beforeEach` block inside `describe("AppShell", () => { ... })` to remove the current theme attribute:

```ts
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useImStore.getState().reset();
  });
```

Add this test after the existing `opens shell settings and toggles message sequence numbers` test:

```tsx
  it("opens shell settings and switches the color theme", async () => {
    const user = userEvent.setup();
    await renderAppRoute({
      initialEntries: ["/app/im"],
      session: makeAuthResponse(),
      apiClient: createShellApiClient(),
    });

    await screen.findByLabelText("Feature rail");
    await user.click(getDesktopSettingsTrigger());

    const popup = screen.getByRole("region", { name: "Settings" });
    expect(within(popup).getByText("Color theme")).toBeInTheDocument();

    const midnightTheme = within(popup).getByRole("button", {
      name: "Midnight",
    });
    expect(midnightTheme).toHaveAttribute("aria-pressed", "false");

    await user.click(midnightTheme);

    expect(midnightTheme).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "midnight");
    expect(window.localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe(
      "midnight",
    );
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test -- src/features/shell/AppShell.test.tsx
```

Expected: FAIL because the Settings menu does not render a `Color theme` section or a `Midnight` button yet.

- [ ] **Step 3: Add localized theme labels**

In `web/src/shared/i18n/resources.ts`, replace the Chinese `settings` block:

```ts
        settings: {
          title: "设置",
          description: "调整聊天界面的显示偏好。",
          messageDisplay: "消息显示",
          sequenceDescription: "用于排查消息顺序问题，默认隐藏。",
        },
```

with:

```ts
        settings: {
          title: "设置",
          description: "调整聊天界面的显示偏好。",
          colorTheme: "颜色主题",
          messageDisplay: "消息显示",
          sequenceDescription: "用于排查消息顺序问题，默认隐藏。",
          themes: {
            mist: "雾蓝",
            midnight: "午夜",
            sakura: "樱花",
            forest: "森林",
          },
        },
```

In the same file, replace the English `settings` block:

```ts
        settings: {
          title: "Settings",
          description: "Adjust how the chat interface is displayed.",
          messageDisplay: "Message display",
          sequenceDescription: "Useful for checking message ordering; hidden by default.",
        },
```

with:

```ts
        settings: {
          title: "Settings",
          description: "Adjust how the chat interface is displayed.",
          colorTheme: "Color theme",
          messageDisplay: "Message display",
          sequenceDescription: "Useful for checking message ordering; hidden by default.",
          themes: {
            mist: "Mist",
            midnight: "Midnight",
            sakura: "Sakura",
            forest: "Forest",
          },
        },
```

- [ ] **Step 4: Replace `ShellSettingsMenu.tsx` with the theme-aware menu**

Replace the full contents of `web/src/features/shell/ShellSettingsMenu.tsx` with this content:

```tsx
import { Palette, Settings } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { useImStore } from "@/features/im/state/imStore";
import { COLOR_THEMES, type ColorTheme } from "@/shared/theme/colorTheme";
import { useColorTheme } from "@/shared/theme/useColorTheme";
import { cn } from "@/shared/utils/cn";

type ShellSettingsMenuPlacement = "rail" | "mobileBar";

type ShellSettingsMenuProps = {
  placement: ShellSettingsMenuPlacement;
};

const COLOR_THEME_SWATCH_CLASS_NAMES: Record<ColorTheme, string> = {
  mist: "bg-[linear-gradient(135deg,#edf4f7_0%,#0f9f8f_100%)]",
  midnight: "bg-[linear-gradient(135deg,#0d1620_0%,#38cdbd_100%)]",
  sakura: "bg-[linear-gradient(135deg,#fff1f5_0%,#d94d7b_100%)]",
  forest: "bg-[linear-gradient(135deg,#eef7ee_0%,#2f9b61_100%)]",
};

export function ShellSettingsMenu({ placement }: ShellSettingsMenuProps) {
  const { t } = useTranslation();
  const disclosurePanelId = useId();
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useColorTheme();
  const showMessageSequenceNumbers = useImStore(
    (state) => state.showMessageSequenceNumbers,
  );
  const toggleShowMessageSequenceNumbers = useImStore(
    (state) => state.toggleShowMessageSequenceNumbers,
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsidePointerDown(event: Event) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (menuRootRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isOpen]);

  function closeDisclosureOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !isOpen) {
      return;
    }

    event.stopPropagation();
    setIsOpen(false);
  }

  return (
    <div
      ref={menuRootRef}
      className={getWrapperClassName(placement)}
      onKeyDown={closeDisclosureOnEscape}
    >
      <button
        aria-controls={disclosurePanelId}
        aria-expanded={isOpen}
        aria-label={t("shell.settings.title")}
        className={getTriggerClassName(placement, isOpen)}
        onClick={() => setIsOpen((value) => !value)}
        title={t("shell.settings.title")}
        type="button"
      >
        <Settings aria-hidden="true" className="size-5" />
        {placement === "mobileBar" ? (
          <span className="hidden text-sm font-bold min-[420px]:inline">
            {t("shell.settings.title")}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          aria-label={t("shell.settings.title")}
          className={cn(
            "absolute z-50 w-80 rounded-[calc(var(--radius)*1.05)] border border-[color-mix(in_oklab,var(--surface)_78%,var(--border))] bg-[color-mix(in_oklab,var(--surface)_94%,transparent)] p-3 text-[var(--foreground)] shadow-[0_24px_70px_var(--shadow-color)] backdrop-blur",
            getPanelPositionClassName(placement),
          )}
          id={disclosurePanelId}
          role="region"
        >
          <div className="mb-3 rounded-[calc(var(--radius)*0.85)] bg-[var(--surface-muted)]/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-black">
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
                <Settings aria-hidden="true" className="size-4" />
              </span>
              {t("shell.settings.title")}
            </div>
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              {t("shell.settings.description")}
            </p>
          </div>

          <div className="space-y-4">
            <section className="space-y-2">
              <p className="flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                <Palette aria-hidden="true" className="size-3.5" />
                {t("shell.settings.colorTheme")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {COLOR_THEMES.map((colorTheme) => (
                  <button
                    key={colorTheme}
                    aria-label={t(`shell.settings.themes.${colorTheme}`)}
                    aria-pressed={theme === colorTheme}
                    className={cn(
                      "flex items-center gap-2 rounded-[calc(var(--radius)*0.75)] border p-2 text-left text-sm font-bold transition-colors",
                      theme === colorTheme
                        ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_12%,var(--surface))] text-[var(--foreground)]"
                        : "border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] text-[var(--foreground)] hover:bg-[var(--surface)]",
                    )}
                    onClick={() => setTheme(colorTheme)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-7 shrink-0 rounded-full border border-white/70 shadow-sm",
                        COLOR_THEME_SWATCH_CLASS_NAMES[colorTheme],
                      )}
                    />
                    <span className="truncate">
                      {t(`shell.settings.themes.${colorTheme}`)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <p className="px-1 text-xs font-black uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                {t("shell.settings.messageDisplay")}
              </p>
              <button
                aria-checked={showMessageSequenceNumbers}
                aria-label={t("im.chat.sequenceToggleAria")}
                className="flex w-full items-center justify-between gap-3 rounded-[calc(var(--radius)*0.85)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] p-3 text-left transition-colors hover:bg-[var(--surface)]"
                onClick={toggleShowMessageSequenceNumbers}
                role="switch"
                type="button"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold">
                    {t("im.chat.sequenceToggleAria")}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                    {t("shell.settings.sequenceDescription")}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
                    showMessageSequenceNumbers
                      ? "border-[var(--primary)] bg-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface-muted)]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform",
                      showMessageSequenceNumbers
                        ? "translate-x-5"
                        : "translate-x-1",
                    )}
                  />
                </span>
              </button>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getWrapperClassName(placement: ShellSettingsMenuPlacement) {
  if (placement === "mobileBar") {
    return "relative flex-none";
  }

  return "relative";
}

function getTriggerClassName(
  placement: ShellSettingsMenuPlacement,
  isOpen: boolean,
) {
  if (placement === "mobileBar") {
    return cn(
      "group flex min-h-12 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.85)] px-4 text-white/74 transition-all duration-200 hover:bg-white/12 hover:text-white",
      isOpen &&
        "bg-[var(--surface)] text-[var(--foreground)] shadow-lg hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
    );
  }

  return cn(
    "group flex size-12 items-center justify-center rounded-[calc(var(--radius)*0.9)] text-white/74 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/12 hover:text-white",
    isOpen && "bg-white/12 text-white shadow-inner",
  );
}

function getPanelPositionClassName(placement: ShellSettingsMenuPlacement) {
  if (placement === "mobileBar") {
    return "bottom-[calc(100%+0.75rem)] right-0";
  }

  return "bottom-0 left-[calc(100%+0.75rem)]";
}
```

- [ ] **Step 5: Apply the saved theme before React mounts**

In `web/src/main.tsx`, add this import after the existing `AppProviders` import:

```ts
import { initializeColorTheme } from "@/shared/theme/colorTheme";
```

Then add this call after the `rootElement` null-check and before `createRoot(rootElement).render(...)`:

```ts
initializeColorTheme();
```

The resulting top of `web/src/main.tsx` should be:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { AppProviders } from "@/app/AppProviders";
import { initializeColorTheme } from "@/shared/theme/colorTheme";
import "@/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

initializeColorTheme();
```

- [ ] **Step 6: Run the focused Settings test and verify GREEN**

Run:

```bash
pnpm test -- src/features/shell/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the Settings integration**

Run from the repository root:

```bash
git add web/src/features/shell/AppShell.test.tsx web/src/shared/i18n/resources.ts web/src/features/shell/ShellSettingsMenu.tsx web/src/main.tsx
git commit -m "feat: add settings color theme switcher"
```

---

### Task 4: Run full Web verification

**Files:**
- Verify only: Web test, typecheck, and build outputs.

**Interfaces:**
- Consumes: all code from Tasks 1 through 3.
- Produces: command output proving the theme feature passes focused tests, TypeScript, and production build.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- src/shared/theme/colorTheme.test.ts src/shared/ui/form-fields.test.tsx src/features/shell/AppShell.test.tsx
```

Expected: PASS for all three test files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS with Vite producing the production bundle.

- [ ] **Step 4: Check git status**

Run from the repository root:

```bash
git status --short
```

Expected: no uncommitted changes. If verification required changes, commit those changed files with a message that names the verified fix.

---

## Self-Review

**Spec coverage:**
- Four fixed themes are implemented by Task 2 CSS token blocks and Task 3 Settings options.
- Browser persistence and invalid fallback are implemented and tested in Task 1.
- Global DOM application through `<html data-theme="...">` is implemented in Task 1 and initialized in Task 3.
- Settings menu switching is implemented and tested in Task 3.
- Chinese and English labels are implemented in Task 3.
- Auth and app pages receive the selected theme through global CSS variables and startup initialization in Tasks 2 and 3.
- API, realtime, routing, auth, and IM store behavior are not modified.

**Placeholder scan:**
- No placeholder markers, incomplete code blocks, or unnamed follow-up work remain.

**Type consistency:**
- `ColorTheme`, `COLOR_THEMES`, `COLOR_THEME_STORAGE_KEY`, `initializeColorTheme`, `setColorTheme`, and `useColorTheme` signatures match between producer and consumer tasks.
