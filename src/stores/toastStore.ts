import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  message: string
  title?: string
  type: ToastType
  duration?: number
}

interface ToastStore {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const item: ToastItem = { ...toast, id }
    set((state) => ({
      toasts: [...state.toasts.slice(-4), item],
    }))

    const duration = toast.duration ?? 3500
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, duration)
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}))

export const toast = {
  success: (message: string, title?: string, duration?: number) =>
    useToastStore
      .getState()
      .addToast({ type: 'success', message, title, duration }),
  error: (message: string, title?: string, duration?: number) =>
    useToastStore
      .getState()
      .addToast({ type: 'error', message, title, duration }),
  warning: (message: string, title?: string, duration?: number) =>
    useToastStore
      .getState()
      .addToast({ type: 'warning', message, title, duration }),
  info: (message: string, title?: string, duration?: number) =>
    useToastStore
      .getState()
      .addToast({ type: 'info', message, title, duration }),
}
