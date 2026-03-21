import React, { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react'
import { type Toast, subscribeToToasts, type ToastType } from '../lib/toaster-store'
import './Toaster.css'

export { addToast } from '../lib/toaster-store'
export type { Toast, ToastType } from '../lib/toaster-store'

const useToastEmitter = () => {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const handler = (t: Toast) => setToasts(prev => [...prev, t])
    const unsubscribe = subscribeToToasts(handler)
    return () => unsubscribe()
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, dismiss }
}

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
  }, [duration, onDismiss, toast.id])

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
