# Web Color Themes Design

## Goal

Add several selectable color themes to the Nano Chat Web UI, exposed from the existing shell Settings menu. The selected theme should apply across the full web app, persist in the browser, and survive page refreshes.

## Approved Theme Set

The first supported theme set is:

1. `mist` — current quiet ink-blue / mist / teal palette; default.
2. `midnight` — dark theme with deep blue surfaces and teal signal colors.
3. `sakura` — light warm-pink theme.
4. `forest` — light green/natural theme.

Theme labels should be localized in Chinese and English.

## Architecture

Use a token-first CSS-variable design:

- Keep the existing component styling pattern based on CSS variables such as `--background`, `--foreground`, `--surface`, `--primary`, and `--border`.
- Keep `:root` as the default `mist` theme.
- Add theme overrides with `html[data-theme="midnight"]`, `html[data-theme="sakura"]`, and `html[data-theme="forest"]` in `web/src/styles.css`.
- Switch themes by setting `document.documentElement.dataset.theme`.

This avoids a broad Tailwind/class rewrite and lets most existing UI pick up theme changes automatically.

## Theme State and Persistence

Add a small shared theme module rather than putting theme state in the IM store:

- Define a `ColorTheme` union: `"mist" | "midnight" | "sakura" | "forest"`.
- Define `COLOR_THEME_STORAGE_KEY = "nano-chat:color-theme"`.
- Read the saved theme from `localStorage` when available.
- Ignore invalid saved values and fall back to `mist`.
- Apply the theme to `document.documentElement.dataset.theme`.
- Persist explicit user selections to `localStorage` on a best-effort basis.

The module should be safe when storage is unavailable.

## App Initialization

Initialize the saved theme as early as practical in the React app startup path so authenticated pages and auth pages both receive the same theme. A small React hook/provider can subscribe UI state to the DOM-applied theme, while the underlying theme module owns validation and DOM persistence.

## Settings Menu UI

Extend `web/src/features/shell/ShellSettingsMenu.tsx`:

- Keep the existing Settings trigger and message sequence toggle.
- Add a new “Color theme” section above or below “Message display”.
- Render one button per theme.
- Each option shows:
  - localized theme name;
  - a small swatch using the theme's primary/surface colors or theme-specific static swatch classes;
  - selected state via `aria-pressed` or equivalent accessible state.
- Clicking an option immediately applies and saves the selected theme.

The menu should continue to close on outside click and Escape exactly as it does today.

## Data Flow

1. App starts.
2. Theme module reads `nano-chat:color-theme`.
3. Theme module applies the valid theme to `<html data-theme="...">`.
4. Settings menu reads current theme through a small hook/state helper.
5. User selects a theme.
6. The selected theme is saved to `localStorage`, applied to `<html>`, and reflected in the menu selected state.

## Error Handling

- If `localStorage.getItem` or `setItem` throws, fall back to `mist` or apply the in-memory selected theme without crashing.
- If the saved theme is unknown, ignore it and use `mist`.
- Theme switching must not affect API, realtime, routing, auth, or IM store behavior.

## Testing

Use test-first implementation.

Recommended test coverage:

1. Shared theme module tests:
   - defaults to `mist` when no saved value exists;
   - restores a valid saved theme;
   - ignores invalid saved values;
   - persists selected theme;
   - applies `document.documentElement.dataset.theme`.
2. Settings menu/AppShell test:
   - opens Settings;
   - shows theme options;
   - selecting Midnight updates `html[data-theme]` and writes `nano-chat:color-theme`.
3. CSS/token contract test:
   - verifies the four theme selectors/tokens exist in `web/src/styles.css`.

## Scope Boundaries

In scope:

- Four fixed color themes.
- Settings menu theme switching.
- Browser persistence.
- Global app/auth page application through existing CSS tokens.
- Localized setting labels and theme names.

Out of scope:

- User-account/server-synced theme preferences.
- Custom theme editor.
- Per-conversation themes.
- Layout redesign.
- Full removal of every hardcoded white/dark utility class in unrelated components.

## Acceptance Criteria

- Users can switch among Mist, Midnight, Sakura, and Forest from Settings.
- The selected theme applies immediately without navigation.
- The selected theme remains after refresh.
- Auth pages and app pages use the selected theme.
- Existing Settings behavior still works.
- Focused tests and Web build/typecheck pass.
