import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const isValidConfig = url && key &&
  url !== 'your_supabase_project_url_here' &&
  key !== 'your_supabase_anon_key_here' &&
  (url.startsWith('http://') || url.startsWith('https://'))

const supabase = isValidConfig ? createClient(url, key) : null

export async function uploadPhoto(
  patientId: string,
  photoDataUrl: string
): Promise<string | null> {
  if (!supabase) {
    console.warn('Supabase not configured, storing photo locally only')
    return photoDataUrl
  }

  try {
    const base64Data = photoDataUrl.split(',')[1]
    const blob = base64ToBlob(base64Data, 'image/jpeg')

    const fileName = `${patientId}-${Date.now()}.jpg`
    const filePath = `patient-photos/${fileName}`

    const { data, error } = await supabase.storage
      .from('photos')
      .upload(filePath, blob, {
        contentType: 'image/jpeg',
        upsert: true
      })

    if (error) {
      console.error('Photo upload error:', error)
      return photoDataUrl
    }

    const { data: urlData } = supabase.storage
      .from('photos')
      .getPublicUrl(filePath)

    return urlData.publicUrl
  } catch (error) {
    console.error('Photo upload failed:', error)
    return photoDataUrl
  }
}

export async function deletePhoto(photoUrl: string): Promise<boolean> {
  if (!supabase || !photoUrl.includes('supabase')) {
    return true
  }

  try {
    const filePath = photoUrl.split('/').slice(-2).join('/')

    const { error } = await supabase.storage
      .from('photos')
      .remove([filePath])

    if (error) {
      console.error('Photo delete error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Photo delete failed:', error)
    return false
  }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64)
  const byteNumbers = new Array(byteCharacters.length)

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }

  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: mimeType })
}

export function compressImage(
  dataUrl: string,
  maxWidth: number = 200,
  maxHeight: number = 200,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      let width = img.width
      let height = img.height

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height
          height = maxHeight
        }
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      const compressed = canvas.toDataURL('image/jpeg', quality)
      resolve(compressed)
    }

    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }

    img.src = dataUrl
  })
}

export function estimatePhotoSize(dataUrl: string): number {
  const base64Length = dataUrl.split(',')[1]?.length || 0
  return Math.ceil(base64Length * 0.75)
}
