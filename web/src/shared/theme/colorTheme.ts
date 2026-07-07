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
