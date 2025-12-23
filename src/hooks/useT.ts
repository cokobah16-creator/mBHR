import { useTranslation } from 'react-i18next'
import type { SupportedLocale } from '@/i18n/types'

export function useT() {
  const { t: i18nT, i18n } = useTranslation()

  const t = (key: string, fallback?: string): string => {
    const translation = i18nT(key)
    if (translation && translation !== key) return translation
    return fallback || key.split('.').pop() || key
  }

  const speak = async (key: string) => {
    const currentLocale = i18n.language as SupportedLocale
    try {
      const audioUrl = `/audio/${currentLocale}/${key.replace('.', '_')}.mp3`
      const audio = new Audio(audioUrl)

      audio.onerror = () => {
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(t(key))
          utterance.lang = getLanguageCode(currentLocale)
          speechSynthesis.speak(utterance)
        }
      }

      await audio.play()
    } catch (error) {
      console.warn('Audio playback failed:', error)

      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(t(key))
        utterance.lang = getLanguageCode(currentLocale)
        speechSynthesis.speak(utterance)
      }
    }
  }

  const changeLocale = async (locale: SupportedLocale) => {
    await i18n.changeLanguage(locale)
  }

  return {
    t,
    speak,
    changeLocale,
    locale: i18n.language as SupportedLocale,
    loading: !i18n.isInitialized,
    error: null
  }
}

// Helper to get proper language codes for speech synthesis
function getLanguageCode(locale: SupportedLocale): string {
  const codes = {
    en: 'en-US',
    ha: 'ha-NG',
    yo: 'yo-NG', 
    ig: 'ig-NG',
    pcm: 'en-NG' // Fallback to Nigerian English for Pidgin
  }
  return codes[locale] || 'en-US'
}