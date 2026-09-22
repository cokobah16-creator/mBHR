import { create } from 'zustand'

export type ToastTone = 'success' | 'info' | 'warning' | 'error'

export type Toast = { id: string; title: string; body?: string; tone?: ToastTone }

type ToastState = {
  items: Toast[]
  push: (t: Toast) => void
  remove: (id: string) => void
}

/** Older call sites pass no tone; infer failures from the title. */
export function toastTone(t: Toast): ToastTone {
  if (t.tone) return t.tone
  return /^(error|failed|could not|not saved)/i.test(t.title) ? 'error' : 'info'
}

export const useToast = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    set(s => ({ items: [...s.items, t] }))
    // Confirmations fade after 6s. Errors and warnings stay until dismissed:
    // a failed save must not disappear before someone reads it.
    const tone = toastTone(t)
    if (tone === 'success' || tone === 'info') {
      setTimeout(() => get().remove(t.id), 6000)
    }
  },
  remove: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}))
