import { create } from 'zustand'

export type Toast = { id: string; title: string; body?: string; type?: 'info' | 'warning' | 'error' | 'success' }

type ToastState = {
  items: Toast[]
  push: (t: Toast) => void
  remove: (id: string) => void
}

export const useToast = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    set(s => ({ items: [...s.items, t] }))
    // auto-dismiss after 6s
    setTimeout(() => get().remove(t.id), 6000)
  },
  remove: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}))