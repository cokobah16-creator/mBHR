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

  // Stable feedback only — colour change on hover/press, a visible focus
  // ring, no scaling. Staff tap these while dispensing and documenting.
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-touch-target'

  const variantClasses = {
    primary: 'bg-primary text-white hover:bg-primary-hover active:bg-primary-active focus-visible:ring-primary',
    secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover active:bg-line focus-visible:ring-primary',
    danger: 'bg-danger text-white hover:bg-danger-fg active:bg-danger-fg focus-visible:ring-danger',
    ghost: 'text-ink-secondary hover:bg-surface-hover hover:text-ink active:bg-line focus-visible:ring-primary'
  }

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm gap-1.5',
    md: 'px-4 py-2.5 text-base gap-2',
    lg: 'px-6 py-3.5 text-lg gap-2.5'
  }

  const widthClass = fullWidth ? 'w-full' : ''

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
      {...props}
    >
      {loading ? (
        <svg aria-hidden className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
