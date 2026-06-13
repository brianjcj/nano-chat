import i18next, { type i18n as I18nInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { appResources } from "./resources";

export const supportedLanguages = ["zh-CN", "en-US"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const fallbackLanguage: SupportedLanguage = "zh-CN";

export type AppI18nOptions = {
  language?: SupportedLanguage;
  useLanguageDetector?: boolean;
};

const detection = {
  order: ["localStorage", "navigator"],
  caches: ["localStorage"],
  lookupLocalStorage: "nano-chat.language",
};

export async function createAppI18n(options: AppI18nOptions = {}) {
  const instance = i18next.createInstance();

  return configureAppI18n(instance, options);
}

export async function configureAppI18n(
  instance: I18nInstance,
  options: AppI18nOptions = {},
) {
  if (options.useLanguageDetector !== false) {
    instance.use(LanguageDetector);
  }

  instance.use(initReactI18next);

  await instance.init({
    resources: appResources,
    supportedLngs: [...supportedLanguages],
    fallbackLng: fallbackLanguage,
    lng: options.language,
    detection,
    interpolation: {
      escapeValue: false,
    },
  });

  return instance;
}

export const i18n = i18next.createInstance();
export const i18nReady = configureAppI18n(i18n);

export default i18n;
