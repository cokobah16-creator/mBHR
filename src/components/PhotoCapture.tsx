import React, { useState, useRef, useCallback } from 'react'
import { CameraIcon, XMarkIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface PhotoCaptureProps {
  onCapture: (photoDataUrl: string) => void
  onCancel: () => void
  currentPhoto?: string
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera in the browser settings, or continue without a photo.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Continue without a photo.'
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another app. Close it and try again.'
  }
  return 'The camera could not start. Try again, or continue without a photo.'
}

export function PhotoCapture({ onCapture, onCancel, currentPhoto }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [preview, setPreview] = useState<string | null>(currentPhoto || null)
  const [error, setError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

  const startCamera = useCallback(async () => {
    setError(null)
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      })

      setStream(mediaStream)
      setCameraActive(true)

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch (err) {
      setError(cameraErrorMessage(err))
      console.error('Camera error:', err instanceof Error ? err.name : err)
    }
  }, [])

  // The <video> element only mounts once the camera is active, so attach the
  // stream after that render as well.
  React.useEffect(() => {
    if (cameraActive && stream && videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream
    }
  }, [cameraActive, stream])

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
      setCameraActive(false)
    }
  }, [stream])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current

    const targetSize = 200
    canvas.width = targetSize
    canvas.height = targetSize

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const videoAspect = video.videoWidth / video.videoHeight
    let sx = 0
    let sy = 0
    let sWidth = video.videoWidth
    let sHeight = video.videoHeight

    if (videoAspect > 1) {
      sWidth = video.videoHeight
      sx = (video.videoWidth - sWidth) / 2
    } else {
      sHeight = video.videoWidth
      sy = (video.videoHeight - sHeight) / 2
    }

    ctx.drawImage(
      video,
      sx, sy, sWidth, sHeight,
      0, 0, targetSize, targetSize
    )

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setPreview(dataUrl)
    stopCamera()
  }, [stopCamera])

  const retakePhoto = () => {
    setPreview(null)
    startCamera()
  }

  const confirmPhoto = () => {
    if (preview) {
      onCapture(preview)
      stopCamera()
    }
  }

  const handleCancel = () => {
    stopCamera()
    onCancel()
  }

  React.useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-capture-title"
        className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleCancel()
        }}
      >
        <button
          type="button"
          onClick={handleCancel}
          className="btn-ghost absolute right-3 top-3 px-2"
          aria-label="Close without taking a photo"
        >
          <XMarkIcon className="h-6 w-6" aria-hidden />
        </button>

        <h2 id="photo-capture-title" className="mb-4 text-h2 text-ink">
          {preview ? 'Photo preview' : 'Take a photo'}
        </h2>

        {error && (
          <div className="banner banner-danger mb-4" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="relative mb-4 overflow-hidden rounded-lg border border-line bg-surface-sunken">
          {preview ? (
            <img
              src={preview}
              alt="Captured photo of the patient"
              className="h-64 w-full object-cover"
            />
          ) : cameraActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Camera preview"
              className="h-64 w-full object-cover"
            />
          ) : (
            <div className="flex h-64 w-full flex-col items-center justify-center text-ink-muted">
              <CameraIcon className="mb-2 h-12 w-12" aria-hidden />
              <p className="text-body">Select Start camera to begin</p>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="flex gap-3">
          {!preview && !cameraActive && (
            <button
              type="button"
              autoFocus
              onClick={startCamera}
              className="btn-primary flex-1"
            >
              <CameraIcon className="h-5 w-5" aria-hidden />
              Start camera
            </button>
          )}

          {cameraActive && !preview && (
            <button
              type="button"
              onClick={capturePhoto}
              className="btn-primary flex-1"
            >
              Take photo
            </button>
          )}

          {preview && (
            <>
              <button
                type="button"
                onClick={retakePhoto}
                className="btn-secondary flex-1"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                Retake
              </button>
              <button
                type="button"
                onClick={confirmPhoto}
                className="btn-primary flex-1"
              >
                Use photo
              </button>
            </>
          )}
        </div>

        <p className="mt-3 text-center text-caption text-ink-muted">
          Photos are reduced to 200 × 200 px and saved with the patient record.
        </p>
      </div>
    </div>
  )
}
