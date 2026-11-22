import type React from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  placement?: 'top' | 'bottom'
  delayMs?: number
  disabled?: boolean
  className?: string
  contentClassName?: string
  interactive?: boolean
}

interface TooltipPosition {
  top: number
  left: number
  arrowLeft: number
  actualPlacement: 'top' | 'bottom'
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  delayMs = 100,
  disabled = false,
  className = '',
  contentClassName = '',
  interactive = false,
}) => {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipId = useId()

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const show = useCallback(() => {
    if (disabled || !content) return
    clearTimer()
    if (delayMs <= 0) {
      setOpen(true)
      return
    }
    timerRef.current = setTimeout(() => {
      setOpen(true)
    }, delayMs)
  }, [clearTimer, content, delayMs, disabled])

  const hide = useCallback(() => {
    clearTimer()
    setOpen(false)
  }, [clearTimer])

  const scheduleHide = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      const trigger = triggerRef.current
      const tooltip = tooltipRef.current
      const isTriggerKeyboardFocused =
        Boolean(trigger?.matches(':focus-visible')) &&
        Boolean(trigger?.contains(document.activeElement))
      if (
        trigger?.matches(':hover') ||
        tooltip?.matches(':hover') ||
        isTriggerKeyboardFocused ||
        tooltip?.contains(document.activeElement)
      ) {
        return
      }
      setOpen(false)
    }, 200)
  }, [clearTimer])

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  useEffect(() => {
    if (!open) return
    const handleWindowBlur = () => hide()
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [open, hide])

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current
    const tooltipEl = tooltipRef.current
    if (!triggerEl || !tooltipEl) return

    const triggerRect = triggerEl.getBoundingClientRect()
    const tooltipRect = tooltipEl.getBoundingClientRect()
    const gap = 8
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let actualPlacement: 'top' | 'bottom' = placement
    if (
      placement === 'top' &&
      triggerRect.top - tooltipRect.height - gap < margin &&
      triggerRect.bottom + tooltipRect.height + gap <= vh - margin
    ) {
      actualPlacement = 'bottom'
    } else if (
      placement === 'bottom' &&
      triggerRect.bottom + tooltipRect.height + gap > vh - margin &&
      triggerRect.top - tooltipRect.height - gap >= margin
    ) {
      actualPlacement = 'top'
    }

    const top =
      actualPlacement === 'top'
        ? triggerRect.top - tooltipRect.height - gap
        : triggerRect.bottom + gap

    const triggerCenter = triggerRect.left + triggerRect.width / 2
    const rawLeft = triggerCenter - tooltipRect.width / 2
    const maxLeft = Math.max(margin, vw - tooltipRect.width - margin)
    const left = Math.min(Math.max(margin, rawLeft), maxLeft)
    const arrowLeft = Math.min(
      Math.max(12, triggerCenter - left),
      Math.max(12, tooltipRect.width - 12),
    )

    setPosition({ top, left, arrowLeft, actualPlacement })
  }, [placement])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition, hide])

  if (disabled || !content) {
    return <>{children}</>
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={interactive ? scheduleHide : hide}
        onFocus={show}
        onBlur={interactive ? scheduleHide : hide}
        onPointerDown={interactive ? undefined : hide}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === 'Escape') hide()
              }
            : undefined
        }
        tabIndex={interactive ? 0 : undefined}
        aria-expanded={interactive ? open : undefined}
        aria-describedby={!interactive && open ? tooltipId : undefined}
        className={`inline-flex items-center max-w-full ${className}`}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            id={tooltipId}
            ref={tooltipRef}
            role={interactive ? 'group' : 'tooltip'}
            onMouseEnter={interactive ? clearTimer : undefined}
            onMouseLeave={interactive ? scheduleHide : undefined}
            onFocus={interactive ? clearTimer : undefined}
            onBlur={interactive ? scheduleHide : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === 'Escape') hide()
                  }
                : undefined
            }
            style={
              position
                ? { top: `${position.top}px`, left: `${position.left}px` }
                : { top: '-9999px', left: '-9999px', visibility: 'hidden' }
            }
            className={`fixed z-[9999] ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} select-none transition-opacity duration-150 ${
              position ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div
              className={`relative bg-popover/95 backdrop-blur-md text-popover-foreground border border-border/80 rounded-lg px-2.5 py-2 shadow-xl ring-1 ring-black/10 dark:ring-white/10 text-[11px] leading-snug ${contentClassName}`}
            >
              {content}
              {position && (
                <span
                  style={{ left: `${position.arrowLeft}px` }}
                  className={`absolute -translate-x-1/2 w-2 h-2 rotate-45 bg-popover/95 border-border/80 ${
                    position.actualPlacement === 'top'
                      ? '-bottom-1 border-r border-b'
                      : '-top-1 border-l border-t'
                  }`}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
