// Offline-first locale loading with fallbacks
import { get, set } from 'idb-keyval'
import type { LocalePack, SupportedLocale, LocaleManifest } from './types'

// Locale manifests
const LOCALE_MANIFESTS: Record<SupportedLocale, LocaleManifest> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    textPack: {} as LocalePack, // Will be loaded
    audioPack: [],
    rtl: false,
    fallback: 'en'
  },
  ha: {
    code: 'ha',
    name: 'Hausa',
    nativeName: 'Hausa',
    textPack: {} as LocalePack,
    audioPack: [],
    rtl: false,
    fallback: 'en'
  },
  yo: {
    code: 'yo',
    name: 'Yoruba',
    nativeName: 'Yorùbá',
    textPack: {} as LocalePack,
    audioPack: [],
    rtl: false,
    fallback: 'en'
  },
  ig: {
    code: 'ig',
    name: 'Igbo',
    nativeName: 'Igbo',
    textPack: {} as LocalePack,
    audioPack: [],
    rtl: false,
    fallback: 'en'
  },
  pcm: {
    code: 'pcm',
    name: 'Nigerian Pidgin',
    nativeName: 'Naija',
    textPack: {} as LocalePack,
    audioPack: [],
    rtl: false,
    fallback: 'en'
  }
}

// Cache key for locale packs
const CACHE_KEY = (locale: SupportedLocale) => `locale:${locale}`

// Load locale pack with caching
export async function loadLocale(locale: SupportedLocale): Promise<LocalePack> {
  try {
    // Try cache first
    const cached = await get(CACHE_KEY(locale))
    if (cached) {
      console.log(`📦 Loaded ${locale} from cache`)
      return cached
    }

    // Load from bundled JSON
    const pack = await import(`./locales/${locale}.json`)
    const localePack = pack.default as LocalePack

    // Cache for offline use
    await set(CACHE_KEY(locale), localePack)
    console.log(`📦 Loaded and cached ${locale}`)
    
    return localePack
  } catch (error) {
    console.warn(`Failed to load locale ${locale}, falling back to English:`, error)
    
    // Fallback to English
    if (locale !== 'en') {
      return loadLocale('en')
    }
    
    // If even English fails, return empty pack
    return {} as LocalePack
  }
}

// Get available locales
export function getAvailableLocales(): LocaleManifest[] {
  return Object.values(LOCALE_MANIFESTS)
}

// Detect user's preferred locale
export function detectLocale(): SupportedLocale {
  // Check localStorage first
  const stored = localStorage.getItem('mbhr-locale') as SupportedLocale
  if (stored && LOCALE_MANIFESTS[stored]) {
    return stored
  }

  // Check browser language
  const browserLang = navigator.language.toLowerCase()
  
  if (browserLang.startsWith('ha')) return 'ha'
  if (browserLang.startsWith('yo')) return 'yo'
  if (browserLang.startsWith('ig')) return 'ig'
  
  // Default to English
  return 'en'
}

// Set user's preferred locale
export function setPreferredLocale(locale: SupportedLocale) {
  localStorage.setItem('mbhr-locale', locale)
}

// Clear locale cache (for updates)
export async function clearLocaleCache() {
  const locales: SupportedLocale[] = ['en', 'ha', 'yo', 'ig', 'pcm']
  for (const locale of locales) {
    await set(CACHE_KEY(locale), undefined)
  }
}