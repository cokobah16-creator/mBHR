import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enTranslations from './locales/en.json'
import haTranslations from './locales/ha.json'
import yoTranslations from './locales/yo.json'
import igTranslations from './locales/ig.json'
import pcmTranslations from './locales/pcm.json'

const resources = {
  en: {
    translation: enTranslations
  },
  ha: {
    translation: haTranslations
  },
  yo: {
    translation: yoTranslations
  },
  ig: {
    translation: igTranslations
  },
  pcm: {
    translation: pcmTranslations
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ha', 'yo', 'ig', 'pcm'],
    debug: false,

    interpolation: {
      escapeValue: false
    },

    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'mbhr-locale',
      caches: ['localStorage']
    }
  })

export default i18n