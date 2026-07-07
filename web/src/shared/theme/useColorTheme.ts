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
