// Enhanced translation hook with audio support
import { useState, useEffect } from 'react'
import { loadLocale, detectLocale, setPreferredLocale } from '@/i18n/load'
import type { MsgKey, SupportedLocale, LocalePack } from '@/i18n/types'

interface TranslationState {
  locale: SupportedLocale
  pack: LocalePack
  loading: boolean
  error: string | null
}

// Global state for translations
let globalState: TranslationState = {
  locale: 'en',
  pack: {},
  loading: true,
  error: null
}

const listeners = new Set<() => void>()

// Notify all hooks of state changes
function notifyListeners() {
  listeners.forEach(listener => listener())
}

// Load locale and update global state
async function loadAndSetLocale(locale: SupportedLocale) {
  try {
    globalState.loading = true
    globalState.error = null
    notifyListeners()

    const pack = await loadLocale(locale)
    globalState = {
      locale,
      pack,
      loading: false,
      error: null
    }
    
    setPreferredLocale(locale)
    notifyListeners()
  } catch (error) {
    globalState.loading = false
    globalState.error = error instanceof Error ? error.message : 'Failed to load locale'
    notifyListeners()
  }
}

// Initialize with detected locale
loadAndSetLocale(detectLocale())

// Translation hook
export function useT() {
  const [, forceUpdate] = useState({})

  useEffect(() => {
    const listener = () => forceUpdate({})
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])

  // Translation function
  const t = (key: MsgKey, fallback?: string): string => {
    const translation = globalState.pack[key]
    if (translation) return translation
    
    // Fallback to key or provided fallback
    return fallback || key.split('.').pop() || key
  }

  // Audio playback function
  const speak = async (key: MsgKey) => {
    try {
      // Try to play audio file first
      const audioUrl = `/audio/${globalState.locale}/${key.replace('.', '_')}.mp3`
      const audio = new Audio(audioUrl)
      
      audio.onerror = () => {
        // Fallback to text-to-speech
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(t(key))
          utterance.lang = getLanguageCode(globalState.locale)
          speechSynthesis.speak(utterance)
        }
      }
      
      await audio.play()
    } catch (error) {
      console.warn('Audio playback failed:', error)
      
      // Fallback to text-to-speech
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(t(key))
        utterance.lang = getLanguageCode(globalState.locale)
        speechSynthesis.speak(utterance)
      }
    }
  }

  // Change locale function
  const changeLocale = (locale: SupportedLocale) => {
    loadAndSetLocale(locale)
  }

  return {
    t,
    speak,
    changeLocale,
    locale: globalState.locale,
    loading: globalState.loading,
    error: globalState.error
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