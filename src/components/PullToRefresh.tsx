import React, { useState, useRef, useEffect, memo } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { useHaptic } from '@/hooks/useMobile'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  threshold?: number
}

export const PullToRefresh = memo(({
  onRefresh,
  children,
  threshold = 80
}: PullToRefreshProps) => {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [canRefresh, setCanRefresh] = useState(false)
  const touchStartY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const haptic = useHaptic()

  const handleTouchStart = (e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isRefreshing || touchStartY.current === 0) return

    const touchY = e.touches[0].clientY
    const distance = touchY - touchStartY.current

    if (distance > 0 && containerRef.current && containerRef.current.scrollTop === 0) {
      e.preventDefault()
      const dampedDistance = Math.min(distance * 0.5, threshold * 1.5)
      setPullDistance(dampedDistance)

      if (dampedDistance >= threshold && !canRefresh) {
        setCanRefresh(true)
        haptic.medium()
      } else if (dampedDistance < threshold && canRefresh) {
        setCanRefresh(false)
        haptic.light()
      }
    }
  }

  const handleTouchEnd = async () => {
    if (canRefresh && !isRefreshing) {
      setIsRefreshing(true)
      haptic.success()

      try {
        await onRefresh()
      } catch (error) {
        console.error('Refresh failed:', error)
        haptic.error()
      } finally {
        setIsRefreshing(false)
        setCanRefresh(false)
      }
    }

    setPullDistance(0)
    touchStartY.current = 0
  }

  const indicatorOpacity = Math.min(pullDistance / threshold, 1)
  const indicatorRotation = (pullDistance / threshold) * 360

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto h-full"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-center transition-all duration-200"
        style={{
          height: pullDistance,
          opacity: indicatorOpacity
        }}
      >
        <div
          className={`p-2 rounded-full bg-primary ${isRefreshing ? 'animate-spin' : ''}`}
          style={{
            transform: isRefreshing ? 'none' : `rotate(${indicatorRotation}deg)`
          }}
        >
          <ArrowPathIcon className="h-6 w-6 text-white" />
        </div>
      </div>

      {/* Content with offset */}
      <div
        className="transition-transform duration-200"
        style={{
          transform: `translateY(${pullDistance}px)`
        }}
      >
        {children}
      </div>
    </div>
  )
})

PullToRefresh.displayName = 'PullToRefresh'
