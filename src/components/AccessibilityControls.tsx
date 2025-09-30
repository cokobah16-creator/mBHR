// Accessibility controls for font size, contrast, and motion
import React, { useState, useEffect } from 'react'
import { 
  AdjustmentsHorizontalIcon,
  EyeIcon,
  SpeakerWaveIcon,
  DevicePhoneMobileIcon
} from '@heroicons/react/24/outline'

interface AccessibilitySettings {
  fontSize: 'small' | 'normal' | 'large' | 'xlarge'
  contrast: 'normal' | 'high'
  reducedMotion: boolean
  audioEnabled: boolean
  largeTargets: boolean
}

const DEFAULT_SETTINGS: AccessibilitySettings = {
  fontSize: 'normal',
  contrast: 'normal',
  reducedMotion: false,
  audioEnabled: true,
  largeTargets: false
}

export function AccessibilityControls() {
  const [isOpen, setIsOpen] = useState(false)
  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('mbhr-accessibility')
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) })
      } catch (error) {
        console.warn('Failed to load accessibility settings:', error)
      }
    }
  }, [])

  useEffect(() => {
    // Apply settings to document
    applySettings(settings)
    
    // Save to localStorage
    localStorage.setItem('mbhr-accessibility', JSON.stringify(settings))
  }, [settings])

  const applySettings = (settings: AccessibilitySettings) => {
    const root = document.documentElement

    // Font size
    root.classList.remove('text-sm', 'text-base', 'text-lg', 'text-xl')
    switch (settings.fontSize) {
      case 'small':
        root.classList.add('text-sm')
        break
      case 'large':
        root.classList.add('text-lg')
        break
      case 'xlarge':
        root.classList.add('text-xl')
        break
      default:
        root.classList.add('text-base')
    }

    // High contrast
    if (settings.contrast === 'high') {
      root.classList.add('high-contrast')
    } else {
      root.classList.remove('high-contrast')
    }

    // Reduced motion
    if (settings.reducedMotion) {
      root.classList.add('reduce-motion')
    } else {
      root.classList.remove('reduce-motion')
    }

    // Large touch targets
    if (settings.largeTargets) {
      root.classList.add('large-targets')
    } else {
      root.classList.remove('large-targets')
    }
  }

  const updateSetting = <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        title="Accessibility Settings"
        aria-label="Open accessibility settings"
      >
        <AdjustmentsHorizontalIcon className="h-5 w-5 text-gray-600" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
              <AdjustmentsHorizontalIcon className="h-5 w-5" />
              <span>Accessibility</span>
            </h3>

            <div className="space-y-4">
              {/* Font Size */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Text Size
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['small', 'normal', 'large', 'xlarge'] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => updateSetting('fontSize', size)}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                        settings.fontSize === size
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {size === 'xlarge' ? 'XL' : size.charAt(0).toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* High Contrast */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <EyeIcon className="h-5 w-5 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">High Contrast</span>
                </div>
                <button
                  onClick={() => updateSetting('contrast', settings.contrast === 'high' ? 'normal' : 'high')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.contrast === 'high' ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.contrast === 'high' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Reduced Motion */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <DevicePhoneMobileIcon className="h-5 w-5 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Reduce Motion</span>
                </div>
                <button
                  onClick={() => updateSetting('reducedMotion', !settings.reducedMotion)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.reducedMotion ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.reducedMotion ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Audio Enabled */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <SpeakerWaveIcon className="h-5 w-5 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Audio Prompts</span>
                </div>
                <button
                  onClick={() => updateSetting('audioEnabled', !settings.audioEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.audioEnabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.audioEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Large Touch Targets */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <DevicePhoneMobileIcon className="h-5 w-5 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Large Buttons</span>
                </div>
                <button
                  onClick={() => updateSetting('largeTargets', !settings.largeTargets)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.largeTargets ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.largeTargets ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Settings are saved locally and apply across all pages
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}