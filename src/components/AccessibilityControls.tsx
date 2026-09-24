// Accessibility controls for font size, contrast, and motion
import React, { useState, useEffect, useId, useRef } from 'react'
import {
  AdjustmentsHorizontalIcon,
  EyeIcon,
  SpeakerWaveIcon,
  DevicePhoneMobileIcon,
} from '@heroicons/react/24/outline'
import { usePopover } from '@/components/shell/usePopover'

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

const STORAGE_KEY = 'mbhr-accessibility'

const FONT_SIZES: { value: AccessibilitySettings['fontSize']; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'XL' },
]

function loadSettings(): AccessibilitySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
  } catch (error) {
    console.warn(
      'Failed to load accessibility settings:',
      error instanceof Error ? error.name : error
    )
  }
  return DEFAULT_SETTINGS
}

function applySettings(settings: AccessibilitySettings) {
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
  root.classList.toggle('high-contrast', settings.contrast === 'high')

  // Reduced motion
  root.classList.toggle('reduce-motion', settings.reducedMotion)

  // Large touch targets
  root.classList.toggle('large-targets', settings.largeTargets)
}

interface ToggleRowProps {
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  checked: boolean
  onChange: () => void
}

/** A full-width switch: the whole row is the 44px touch target. */
function ToggleRow({ label, icon: Icon, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full min-h-touch-target items-center justify-between gap-3 rounded-md px-2 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex items-center gap-2 text-body text-ink">
        <Icon className="h-5 w-5 text-ink-muted" aria-hidden />
        {label}
      </span>
      <span className="flex items-center gap-2" aria-hidden>
        <span className="w-6 text-right text-caption text-ink-muted">
          {checked ? 'On' : 'Off'}
        </span>
        <span
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? 'bg-primary' : 'bg-line-strong'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </span>
      </span>
    </button>
  )
}

export function AccessibilityControls() {
  const { open: isOpen, setOpen: setIsOpen, ref } = usePopover()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings)
  const panelId = useId()

  useEffect(() => {
    // Apply settings to document
    applySettings(settings)

    // Save to localStorage (may be unavailable in private browsing)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Settings still apply for this visit.
    }
  }, [settings])

  const updateSetting = <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  // usePopover closes on Escape; send focus back to the button that opened it.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') triggerRef.current?.focus()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-h-touch-target min-w-touch-target items-center justify-center rounded-md border border-line-strong bg-surface text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title="Accessibility settings"
        aria-label="Open accessibility settings"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <AdjustmentsHorizontalIcon className="h-5 w-5" aria-hidden />
      </button>

      {isOpen && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={`${panelId}-title`}
          onKeyDown={onPanelKeyDown}
          className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-xl"
        >
          <div className="p-4">
            <h3
              id={`${panelId}-title`}
              className="text-h3 text-ink mb-3 flex items-center gap-2"
            >
              <AdjustmentsHorizontalIcon className="h-5 w-5 text-ink-muted" aria-hidden />
              Accessibility
            </h3>

            <div className="space-y-3">
              {/* Font Size */}
              <div>
                <p id={`${panelId}-size`} className="field-label">
                  Text size
                </p>
                <div
                  role="group"
                  aria-labelledby={`${panelId}-size`}
                  className="grid grid-cols-4 gap-1 rounded-md border border-line bg-surface-sunken p-1"
                >
                  {FONT_SIZES.map(({ value, label }) => {
                    const active = settings.fontSize === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateSetting('fontSize', value)}
                        aria-pressed={active}
                        aria-label={value === 'xlarge' ? 'Extra large' : undefined}
                        className={`min-h-touch-target rounded-md text-label transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active
                            ? 'bg-surface text-ink border border-line-strong shadow-sm'
                            : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="-mx-2 space-y-0.5">
                <ToggleRow
                  label="High contrast"
                  icon={EyeIcon}
                  checked={settings.contrast === 'high'}
                  onChange={() =>
                    updateSetting('contrast', settings.contrast === 'high' ? 'normal' : 'high')
                  }
                />
                <ToggleRow
                  label="Reduce motion"
                  icon={DevicePhoneMobileIcon}
                  checked={settings.reducedMotion}
                  onChange={() => updateSetting('reducedMotion', !settings.reducedMotion)}
                />
                <ToggleRow
                  label="Audio prompts"
                  icon={SpeakerWaveIcon}
                  checked={settings.audioEnabled}
                  onChange={() => updateSetting('audioEnabled', !settings.audioEnabled)}
                />
                <ToggleRow
                  label="Large touch targets"
                  icon={DevicePhoneMobileIcon}
                  checked={settings.largeTargets}
                  onChange={() => updateSetting('largeTargets', !settings.largeTargets)}
                />
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-line">
              <p className="text-caption text-ink-muted">
                Saved on this device and applied to every page.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
