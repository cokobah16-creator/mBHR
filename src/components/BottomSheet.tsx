import React, { useEffect, useId, useState, useRef, memo } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useScrollLock, useSwipe, useHaptic } from '@/hooks/useMobile'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  snapPoints?: number[]
  initialSnap?: number
}

export const BottomSheet = memo(({
  isOpen,
  onClose,
  title,
  children,
  snapPoints = [0.9, 0.5],
  initialSnap = 0
}: BottomSheetProps) => {
  const [snapIndex, setSnapIndex] = useState(initialSnap)
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const haptic = useHaptic()

  useScrollLock()

  const swipeHandlers = useSwipe(
    undefined,
    undefined,
    () => {
      if (snapIndex < snapPoints.length - 1) {
        setSnapIndex(snapIndex + 1)
        haptic.light()
      }
    },
    () => {
      if (snapIndex > 0) {
        setSnapIndex(snapIndex - 1)
        haptic.light()
      } else {
        handleClose()
      }
    }
  )

  const handleClose = () => {
    haptic.light()
    onClose()
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Move focus into the sheet on open and hand it back on close.
  useEffect(() => {
    if (!isOpen) return
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [isOpen])

  // Escape closes, like the close button.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const height = `${snapPoints[snapIndex] * 100}%`

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/50 animate-fade-in"
        onClick={handleClose}
        aria-hidden
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Sheet'}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-line bg-surface shadow-xl animate-slide-up"
        style={{ height, maxHeight: '95vh' }}
        {...swipeHandlers}
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2" aria-hidden>
          <div className="h-1.5 w-12 rounded-full bg-line-strong" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-6">
          {title && (
            <h2 id={titleId} className="text-h2 text-ink">
              {title}
            </h2>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={handleClose}
            className="btn-ghost -mr-2 ml-auto min-w-touch-target px-2"
            aria-label="Close"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-4 py-4 sm:px-6" style={{ maxHeight: 'calc(95vh - 100px)' }}>
          {children}
        </div>
      </div>
    </>
  )
})

BottomSheet.displayName = 'BottomSheet'
