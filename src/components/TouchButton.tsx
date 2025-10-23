import React, { memo, ButtonHTMLAttributes } from 'react'
import { useHaptic } from '@/hooks/useMobile'

interface TouchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  hapticFeedback?: boolean
  loading?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}

export const TouchButton = memo(({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  hapticFeedback = true,
  loading = false,
  icon,
  children,
  onClick,
  className = '',
  disabled,
  ...props
}: TouchButtonProps) => {
  const haptic = useHaptic()

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (hapticFeedback && !disabled) {
      haptic.light()
    }
    if (onClick) {
      onClick(e)
    }
  }

  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-h-touch-target'

  const variantClasses = {
    primary: 'bg-primary text-white hover:bg-primary/90 active:bg-primary/80 shadow-sm',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 active:bg-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
    ghost: 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
  }

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm gap-1.5',
    md: 'px-4 py-3 text-base gap-2',
    lg: 'px-6 py-4 text-lg gap-3'
  }

  const widthClass = fullWidth ? 'w-full' : ''

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : icon ? (
        <span className="flex-shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  )
})

TouchButton.displayName = 'TouchButton'
