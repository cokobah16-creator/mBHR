// Language selector with audio preview
import React, { useState } from 'react'
import { useT } from '@/hooks/useT'
import { getAvailableLocales } from '@/i18n/load'
import type { SupportedLocale } from '@/i18n/types'
import { 
  LanguageIcon, 
  SpeakerWaveIcon,
  CheckIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline'

interface LanguageSelectorProps {
  className?: string
  showAudioPreview?: boolean
}

export function LanguageSelector({ className = '', showAudioPreview = true }: LanguageSelectorProps) {
  const { t, speak, changeLocale, locale, loading } = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  
  const availableLocales = getAvailableLocales()
  const currentLocale = availableLocales.find(l => l.code === locale)

  const handleLocaleChange = (newLocale: SupportedLocale) => {
    changeLocale(newLocale)
    setIsOpen(false)
  }

  const playAudioPreview = async (localeCode: SupportedLocale) => {
    setPlayingAudio(localeCode)
    try {
      // Play a sample phrase in the selected language
      await speak('auth.welcome')
    } catch (error) {
      console.warn('Audio preview failed:', error)
    } finally {
      setPlayingAudio(null)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        disabled={loading}
      >
        <LanguageIcon className="h-5 w-5 text-gray-600" />
        <span className="text-sm font-medium text-gray-700">
          {currentLocale?.nativeName || 'English'}
        </span>
        <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2">
              Select Language
            </div>
            
            {availableLocales.map((localeOption) => (
              <div
                key={localeOption.code}
                className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer group"
                onClick={() => handleLocaleChange(localeOption.code)}
              >
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900">
                      {localeOption.nativeName}
                    </span>
                    {localeOption.code !== 'en' && (
                      <span className="text-xs text-gray-500">
                        ({localeOption.name})
                      </span>
                    )}
                  </div>
                  {locale === localeOption.code && (
                    <CheckIcon className="h-4 w-4 text-primary" />
                  )}
                </div>
                
                {showAudioPreview && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      playAudioPreview(localeOption.code)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all"
                    disabled={playingAudio === localeOption.code}
                  >
                    <SpeakerWaveIcon className={`h-4 w-4 text-gray-600 ${
                      playingAudio === localeOption.code ? 'animate-pulse' : ''
                    }`} />
                  </button>
                )}
              </div>
            ))}
          </div>
          
          <div className="border-t border-gray-100 p-3">
            <p className="text-xs text-gray-500">
              🔊 Audio support available for key phrases
            </p>
          </div>
        </div>
      )}
    </div>
  )
}