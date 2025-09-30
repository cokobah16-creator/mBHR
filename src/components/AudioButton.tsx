import React from 'react'
import { useAudioPrompts } from '@/hooks/useAudioPrompts'
import { SpeakerWaveIcon } from '@heroicons/react/24/outline'

interface AudioButtonProps {
  audioKey: string
  fallbackText?: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}

export function AudioButton({
  audioKey,
  fallbackText,
  children,
  className = '',
  onClick,
  disabled = false,
  type = 'button'
}: AudioButtonProps) {
  const { playPrompt, settings } = useAudioPrompts()

  const handleClick = async () => {
    // Play audio prompt if enabled
    if (settings.enabled) {
      await playPrompt(audioKey, fallbackText)
    }
    
    // Execute the actual click handler
    if (onClick) {
      onClick()
    }
  }

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={`relative ${className}`}
    >
      {children}
      {settings.enabled && (
        <SpeakerWaveIcon className="absolute top-1 right-1 h-3 w-3 text-white/70" />
      )}
    </button>
  )
}