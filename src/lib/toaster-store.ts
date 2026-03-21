export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number // ms, default 5000; 0 = never auto-dismiss
}

type ToastListener = (toast: Toast) => void
const listeners: ToastListener[] = []

export const addToast = (toast: Omit<Toast, 'id'>) => {
  const full: Toast = { id: Math.random().toString(36).slice(2), ...toast }
  listeners.forEach(l => l(full))
}

export const subscribeToToasts = (handler: ToastListener) => {
  listeners.push(handler)
  return () => {
    const idx = listeners.indexOf(handler)
    if (idx !== -1) listeners.splice(idx, 1)
  }
}
