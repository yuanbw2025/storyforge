import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => removeToast(id), 3500)
  }, [removeToast])

  const value: ToastContextValue = {
    toast,
    success: (msg) => toast('success', msg),
    error: (msg) => toast('error', msg),
    info: (msg) => toast('info', msg),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器 */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastMessage key={t.id} item={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// --- Toast 单条消息 ---

const ICONS: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

const COLORS: Record<ToastType, string> = {
  success: 'bg-success/15 text-success border-success/30',
  error: 'bg-error/15 text-error border-error/30',
  info: 'bg-accent/15 text-accent border-accent/30',
}

function ToastMessage({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [show, setShow] = useState(false)
  const Icon = ICONS[item.type]

  useEffect(() => {
    requestAnimationFrame(() => setShow(true))
  }, [])

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg border text-sm
        shadow-lg backdrop-blur-sm min-w-[240px] max-w-[380px]
        transition-all duration-300 ease-out
        ${show ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}
        ${COLORS[item.type]}
      `}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{item.message}</span>
      <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
