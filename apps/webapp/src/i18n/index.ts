/**
 * react-i18next setup — EN + UK, ICU plural support, persistent locale.
 *
 * Initial language detection per spec §13:
 *   explicit setting (localStorage) → Telegram `language_code` → 'en'
 * Locale changes write back to localStorage so the app respects the
 * user's choice on next launch.
 */

import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";

import enBrand from "@/locales/en/brand.json";
import enCommon from "@/locales/en/common.json";
import enCreate from "@/locales/en/create.json";
import enDev from "@/locales/en/dev.json";
import enHome from "@/locales/en/home.json";
import enSettings from "@/locales/en/settings.json";
import ukBrand from "@/locales/uk/brand.json";
import ukCommon from "@/locales/uk/common.json";
import ukCreate from "@/locales/uk/create.json";
import ukDev from "@/locales/uk/dev.json";
import ukHome from "@/locales/uk/home.json";
import ukSettings from "@/locales/uk/settings.json";

import { readUserLanguage } from "@/lib/telegram";

export const SUPPORTED_LOCALES = ["en", "uk"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = "hoba.lang";

function detectInitialLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "uk" || stored === "en") return stored;
  }
  const tgLang = readUserLanguage();
  if (tgLang === "uk") return "uk";
  return "en";
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        brand: enBrand,
        home: enHome,
        settings: enSettings,
        dev: enDev,
        create: enCreate,
      },
      uk: {
        common: ukCommon,
        brand: ukBrand,
        home: ukHome,
        settings: ukSettings,
        dev: ukDev,
        create: ukCreate,
      },
    },
    lng: detectInitialLocale(),
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "brand", "home", "settings", "dev", "create"],
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, locale);
  }
}

export default i18n;
