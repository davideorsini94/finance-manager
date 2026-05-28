import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import it from './locales/it.json';
import en from './locales/en.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'it',
    supportedLngs: ['it', 'en'],
    debug: false,
    interpolation: { escapeValue: false },
    resources: {
      it: { translation: it },
      en: { translation: en },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'fm.lang',
    },
  });

export default i18n;
