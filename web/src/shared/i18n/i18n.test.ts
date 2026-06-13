import { describe, expect, it } from "vitest";

import { createAppI18n, fallbackLanguage } from "./i18n";
import { appResources } from "./resources";

describe("i18n resources", () => {
  it("provides auth, shell, im, errors, and common labels for zh-CN and en-US", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      const translation = appResources[language].translation;

      expect(translation.auth.login.title).toBeTruthy();
      expect(translation.shell.userMenu.logout).toBeTruthy();
      expect(translation.im.conversationList.emptyTitle).toBeTruthy();
      expect(translation.errors.invalid_credentials).toBeTruthy();
      expect(translation.common.save).toBeTruthy();
    }
  });

  it("uses zh-CN as fallback language", () => {
    expect(fallbackLanguage).toBe("zh-CN");
  });

  it("can change language to en-US and translate a known key", async () => {
    const i18n = await createAppI18n({
      language: "zh-CN",
      useLanguageDetector: false,
    });

    await i18n.changeLanguage("en-US");

    expect(i18n.t("auth.login.title")).toBe("Sign in to Nano Chat");
  });
});
