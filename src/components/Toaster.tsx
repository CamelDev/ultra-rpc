import React, { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react'
import './Toaster.css'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number // ms, default 5000; 0 = never auto-dismiss
}

// ─── Global toast emitter (no Context needed) ─────────────────────────────
type ToastListener = (toast: Toast) => void
const listeners: ToastListener[] = []

export const addToast = (toast: Omit<Toast, 'id'>) => {
  const full: Toast = { id: Math.random().toString(36).slice(2), ...toast }
  listeners.forEach(l => l(full))
}

export const useToastEmitter = () => {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const handler: ToastListener = (t) => setToasts(prev => [...prev, t])
    listeners.push(handler)
    return () => {
      const idx = listeners.indexOf(handler)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, dismiss }
}

// ─── Single Toast Item ────────────────────────────────────────────────────
const ICONS: Record<ToastType, React.ReactNode> = {
  info: <Info size={15} />,
  success: <CheckCircle size={15} />,
  warning: <AlertTriangle size={15} />,
  error: <AlertCircle size={15} />,
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: string) => void
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const duration = toast.duration ?? 5000

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setVisible(true))

    if (duration > 0) {
      timerRef.current = setTimeout(() => onDismiss(toast.id), duration)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return (
    <div className={`toast toast--${toast.type} ${visible ? 'toast--visible' : ''}`}>
      <span className="toast__icon">{ICONS[toast.type]}</span>
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" onClick={() => onDismiss(toast.id)}>
        <X size={13} />
      </button>
    </div>
  )
}

// ─── Toaster (mount once at app root) ────────────────────────────────────
export const Toaster: React.FC = () => {
  const { toasts, dismiss } = useToastEmitter()

  return createPortal(
    <div className="toaster">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>,
    document.body
  )
}

export default Toaster
