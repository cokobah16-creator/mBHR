import { useState, useEffect } from 'react'
import { useT } from '@/hooks/useT'

interface AudioSettings {
  enabled: boolean
  volume: number
  autoPlay: boolean
}

const DEFAULT_SETTINGS: AudioSettings = {
  enabled: true,
  volume: 0.7,
  autoPlay: false
}

export function useAudioPrompts() {
  const { locale } = useT()
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('mbhr-audio-settings')
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) })
      } catch (error) {
        console.warn('Failed to load audio settings:', error)
      }
    }
  }, [])

  useEffect(() => {
    // Save settings to localStorage
    localStorage.setItem('mbhr-audio-settings', JSON.stringify(settings))
  }, [settings])

  const playPrompt = async (key: string, fallbackText?: string) => {
    if (!settings.enabled || isPlaying) return

    setIsPlaying(true)
    try {
      // Try to play audio file first
      const audioUrl = `/audio/${locale}/${key.replace('.', '_')}.mp3`
      const audio = new Audio(audioUrl)
      audio.volume = settings.volume
      
      audio.onerror = () => {
        // Fallback to text-to-speech
        if ('speechSynthesis' in window && (fallbackText || key)) {
          const utterance = new SpeechSynthesisUtterance(fallbackText || key)
          utterance.lang = getLanguageCode(locale)
          utterance.volume = settings.volume
          speechSynthesis.speak(utterance)
        }
      }
      
      await audio.play()
    } catch (error) {
      console.warn('Audio playback failed:', error)
      
      // Fallback to text-to-speech
      if ('speechSynthesis' in window && (fallbackText || key)) {
        const utterance = new SpeechSynthesisUtterance(fallbackText || key)
        utterance.lang = getLanguageCode(locale)
        utterance.volume = settings.volume
        speechSynthesis.speak(utterance)
      }
    } finally {
      setTimeout(() => setIsPlaying(false), 1000) // Prevent rapid-fire audio
    }
  }

  const updateSettings = (newSettings: Partial<AudioSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }

  return {
    playPrompt,
    settings,
    updateSettings,
    isPlaying
  }
}

// Helper to get proper language codes for speech synthesis
function getLanguageCode(locale: string): string {
  const codes: Record<string, string> = {
    en: 'en-US',
    ha: 'ha-NG',
    yo: 'yo-NG', 
    ig: 'ig-NG',
    pcm: 'en-NG' // Fallback to Nigerian English for Pidgin
  }
  return codes[locale] || 'en-US'
}