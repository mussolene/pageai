import enTranslations from "./locales/en.json";
import ruTranslations from "./locales/ru.json";

export type Locale = "en" | "ru";

export const supportedLocales: Locale[] = ["en", "ru"];

const translations: Record<Locale, typeof enTranslations> = {
  en: enTranslations,
  ru: ruTranslations
};

/** Locale from browser/system language (navigator.language). */
export function getLocale(): Locale {
  const browserLang = navigator.language.split("-")[0];
  return supportedLocales.includes(browserLang as Locale) ? (browserLang as Locale) : "en";
}

export function setLocale(locale: Locale): void {
  chrome.storage.sync.set({ locale });
}

/** Current locale: stored override or browser/system language. */
export async function getStoredLocale(): Promise<Locale> {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ locale: getLocale() }, (items) => {
      resolve((items.locale as Locale) || getLocale());
    });
  });
}

export function t(key: string, locale?: Locale): string {
  const currentLocale = locale || getLocale();
  const keys = key.split(".");
  let value: any = translations[currentLocale];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = value[k];
    } else {
      return key;
    }
  }

  return typeof value === "string" ? value : key;
}

export async function translate(key: string): Promise<string> {
  const locale = await getStoredLocale();
  return t(key, locale);
}
