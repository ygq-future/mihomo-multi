import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ToastItem, useToastStore } from '../../stores/toastStore'

interface ToastCardProps {
  item: ToastItem
  onRemove: () => void
}

const ToastCard: React.FC<ToastCardProps> = ({ item, onRemove }) => {
  const [isExiting, setIsExiting] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const duration = item.duration ?? 3500

  const handleDismiss = useCallback(() => {
    if (isExiting) return
    setIsExiting(true)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setTimeout(() => {
      onRemove()
    }, 180)
  }, [isExiting, onRemove])

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      handleDismiss()
    }, duration)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [duration, handleDismiss])

  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handleMouseLeave = () => {
    if (!isExiting && !timerRef.current) {
      timerRef.current = setTimeout(() => {
        handleDismiss()
      }, 1500)
    }
  }

  const isSuccess = item.type === 'success'
  const isWarning = item.type === 'warning'
  const isError = item.type === 'error'

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`p-3.5 rounded-xl shadow-2xl border text-xs pointer-events-auto flex items-start gap-2.5 transition-all duration-150 ${
        isExiting
          ? 'animate-toast-exit pointer-events-none'
          : 'animate-toast-enter'
      } ${
        isSuccess
          ? 'bg-card/95 border-emerald-500/30 text-foreground'
          : isWarning
            ? 'bg-card/95 border-amber-500/30 text-foreground'
            : isError
              ? 'bg-card/95 border-destructive/30 text-foreground'
              : 'bg-card/95 border-border text-foreground'
      }`}
    >
      {isSuccess && (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
      )}
      {isWarning && (
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      )}
      {isError && (
        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
      )}
      {!isSuccess && !isWarning && !isError && (
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      )}

      <div className="space-y-0.5 flex-1 min-w-0">
        {item.title && (
          <div className="font-semibold text-foreground leading-none">
            {item.title}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
          {item.message}
        </p>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[99999] flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onRemove={() => removeToast(item.id)}
        />
      ))}
    </div>
  )
}
