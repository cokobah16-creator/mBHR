import { useState, useEffect } from 'react'

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false)
  const [isTouch, setIsTouch] = useState(false)
  const [screenSize, setScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  })

  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth
      setIsMobile(width < 768)
      setScreenSize({ width, height: window.innerHeight })
    }

    const checkTouch = () => {
      setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
    }

    checkMobile()
    checkTouch()

    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return { isMobile, isTouch, screenSize }
}

export function useSwipe(onSwipeLeft?: () => void, onSwipeRight?: () => void, onSwipeUp?: () => void, onSwipeDown?: () => void) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null)

  const minSwipeDistance = 50

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null)
    setTouchStart({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    })
  }

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    })
  }

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return

    const distanceX = touchStart.x - touchEnd.x
    const distanceY = touchStart.y - touchEnd.y
    const isLeftSwipe = distanceX > minSwipeDistance
    const isRightSwipe = distanceX < -minSwipeDistance
    const isUpSwipe = distanceY > minSwipeDistance
    const isDownSwipe = distanceY < -minSwipeDistance

    if (Math.abs(distanceX) > Math.abs(distanceY)) {
      if (isLeftSwipe && onSwipeLeft) onSwipeLeft()
      if (isRightSwipe && onSwipeRight) onSwipeRight()
    } else {
      if (isUpSwipe && onSwipeUp) onSwipeUp()
      if (isDownSwipe && onSwipeDown) onSwipeDown()
    }
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}

export function useHaptic() {
  const vibrate = (pattern: number | number[] = 10) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  }

  return {
    light: () => vibrate(10),
    medium: () => vibrate(20),
    heavy: () => vibrate(30),
    success: () => vibrate([10, 50, 10]),
    error: () => vibrate([20, 100, 20]),
    warning: () => vibrate([10, 30, 10, 30, 10])
  }
}

export function useScrollLock() {
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalStyle
    }
  }, [])
}

export function useOrientation() {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')

  useEffect(() => {
    const handleOrientationChange = () => {
      if (window.matchMedia('(orientation: portrait)').matches) {
        setOrientation('portrait')
      } else {
        setOrientation('landscape')
      }
    }

    handleOrientationChange()

    window.addEventListener('resize', handleOrientationChange)
    return () => window.removeEventListener('resize', handleOrientationChange)
  }, [])

  return orientation
}
