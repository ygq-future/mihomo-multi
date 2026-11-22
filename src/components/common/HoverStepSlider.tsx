import { useTranslation } from '../../i18n'
import { Globe, Loader2, Lock, Shield } from 'lucide-react'
import { toast } from '../../stores/toastStore'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface StepItem {
  value: number
  label: string
}

export type HoverStepSliderMode = 'port' | 'egress'
export type HoverStepSliderAlign = 'auto' | 'left' | 'right' | 'center'

export interface HoverStepSliderProps {
  value: number // 0, 1, 2
  onChange: (value: number) => void
  steps?: StepItem[]
  disabled?: boolean
  loading?: boolean
  className?: string
  lockedSteps?: number[]
  lockedTooltip?: string
  maxAllowedStep?: number
  headerTitle?: string
  mode?: HoverStepSliderMode
  popoverAlign?: HoverStepSliderAlign
}

interface Coords {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

const HOVER_OPEN_DELAY_MS = 400
const HOVER_CLOSE_DELAY_MS = 160
const POPOVER_GAP_PX = 6
const VIEWPORT_PADDING_PX = 8

function getStepDotClass(stepValue: number, mode: HoverStepSliderMode): string {
  if (stepValue === 0) return 'bg-muted-foreground/60'
  if (mode === 'egress') {
    return stepValue === 1 ? 'bg-sky-500' : 'bg-purple-500'
  }
  return stepValue === 1 ? 'bg-emerald-500' : 'bg-sky-500'
}

export const HoverStepSlider: React.FC<HoverStepSliderProps> = ({
  value,
  onChange,
  steps: customSteps,
  disabled = false,
  loading = false,
  className = '',
  lockedSteps,
  lockedTooltip,
  maxAllowedStep,
  mode = 'port',
  popoverAlign,
}) => {
  const { t } = useTranslation()
  const steps =
    customSteps ||
    (mode === 'egress'
      ? [
          { value: 0, label: t('stepSlider.off') },
          { value: 1, label: t('stepSlider.systemProxy') },
          { value: 2, label: 'TUN' },
        ]
      : [
          { value: 0, label: t('stepSlider.disabled') },
          { value: 1, label: t('stepSlider.listening') },
          { value: 2, label: t('stepSlider.systemProxy') },
        ])

  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const isHoveredRef = useRef(false)

  const maxStep = steps.length - 1
  const clampedValue = Math.max(0, Math.min(maxStep, value))
  const currentStep = steps[clampedValue] ?? steps[0]

  const isStepLocked = useCallback(
    (stepVal: number) =>
      Boolean(
        lockedSteps?.includes(stepVal) ||
          (maxAllowedStep !== undefined && stepVal > maxAllowedStep),
      ),
    [lockedSteps, maxAllowedStep],
  )

  const clearPendingTimers = useCallback(() => {
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }, [])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popRect = popoverRef.current?.getBoundingClientRect()
    const popoverWidth = popRect?.width || 136
    const popoverHeight = popRect?.height || 30

    const effectiveAlign =
      popoverAlign ?? (mode === 'egress' ? 'left' : 'right')

    let left: number
    if (effectiveAlign === 'left') {
      left = rect.left
    } else if (effectiveAlign === 'center') {
      left = rect.left + rect.width / 2 - popoverWidth / 2
    } else if (effectiveAlign === 'right') {
      left = rect.right - popoverWidth
    } else if (rect.left + popoverWidth <= window.innerWidth - VIEWPORT_PADDING_PX) {
      left = rect.left
    } else {
      left = rect.right - popoverWidth
    }

    left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(left, window.innerWidth - popoverWidth - VIEWPORT_PADDING_PX),
    )

    let top = rect.top - popoverHeight - POPOVER_GAP_PX
    let placement: 'top' | 'bottom' = 'top'
    if (top < VIEWPORT_PADDING_PX) {
      top = rect.bottom + POPOVER_GAP_PX
      placement = 'bottom'
    }

    setCoords({ top, left, placement })
  }, [mode, popoverAlign])

  const isRelatedInside = useCallback(
    (relatedTarget: EventTarget | null): boolean => {
      if (!relatedTarget || !(relatedTarget instanceof Node)) return false
      return Boolean(
        triggerRef.current?.contains(relatedTarget) ||
          popoverRef.current?.contains(relatedTarget),
      )
    },
    [],
  )

  const handleMouseEnter = useCallback(() => {
    if (disabled) return
    isHoveredRef.current = true
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    if (isOpen) return

    if (enterTimerRef.current === null) {
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null
        if (isHoveredRef.current) {
          updatePosition()
          setIsOpen(true)
        }
      }, HOVER_OPEN_DELAY_MS)
    }
  }, [disabled, isOpen, updatePosition])

  const handleMouseLeave = useCallback(
    (e?: ReactMouseEvent) => {
      if (e?.relatedTarget && isRelatedInside(e.relatedTarget)) {
        return
      }

      isHoveredRef.current = false
      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current)
        enterTimerRef.current = null
      }
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current)
      }
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null
        if (!isHoveredRef.current) {
          setIsOpen(false)
        }
      }, HOVER_CLOSE_DELAY_MS)
    },
    [isRelatedInside],
  )

  useEffect(() => clearPendingTimers, [clearPendingTimers])

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null)
      return
    }
    updatePosition()
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) return
    const handleDismiss = () => {
      clearPendingTimers()
      isHoveredRef.current = false
      setIsOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss()
      }
    }
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('blur', handleDismiss)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('app:dismiss-popovers', handleDismiss)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('blur', handleDismiss)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('app:dismiss-popovers', handleDismiss)
    }
  }, [clearPendingTimers, isOpen, updatePosition])

  const handleSelectStep = useCallback(
    (stepVal: number) => {
      if (disabled || loading) return
      if (isStepLocked(stepVal)) {
        toast.warning(lockedTooltip || t('ports.directNoSysProxy'))
        return
      }
      if (stepVal !== clampedValue) {
        onChange(stepVal)
      }
    },
    [clampedValue, disabled, isStepLocked, loading, lockedTooltip, onChange, t],
  )

  const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || loading) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      handleSelectStep(Math.min(maxStep, clampedValue + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      handleSelectStep(Math.max(0, clampedValue - 1))
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault()
      isHoveredRef.current = false
      setIsOpen(false)
    }
  }

  const triggerTrackClass =
    clampedValue === 0
      ? 'bg-secondary/60 border-border/70'
      : mode === 'egress'
        ? clampedValue === 1
          ? 'bg-sky-500/12 border-sky-500/30'
          : 'bg-purple-500/12 border-purple-500/30'
        : clampedValue === 1
          ? 'bg-emerald-500/12 border-emerald-500/30'
          : 'bg-sky-500/12 border-sky-500/30'

  const thumbColorClass =
    clampedValue === 0
      ? 'bg-muted-foreground/55'
      : mode === 'egress'
        ? clampedValue === 1
          ? 'bg-sky-400'
          : 'bg-purple-400'
        : clampedValue === 1
          ? 'bg-emerald-400'
          : 'bg-sky-400'

  const thumbTranslate =
    clampedValue === 0
      ? 'translate-x-0'
      : clampedValue === 1
        ? 'translate-x-[9px]'
        : 'translate-x-[18px]'
  const accessibleStateLabel = currentStep.label.startsWith('stepSlider.')
    ? t(
        currentStep.label as
          | 'stepSlider.disabled'
          | 'stepSlider.listening'
          | 'stepSlider.systemProxy',
      )
    : currentStep.label

  return (
    <div
      className={`relative inline-flex items-center select-none ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger Capsule: 38px x 20px tactile 3-step switch */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || loading}
        onClick={() => handleSelectStep(clampedValue === 0 ? 1 : 0)}
        onKeyDown={handleTriggerKeyDown}
        aria-label={t('stepSlider.currentStateTitle', {
          label: accessibleStateLabel,
        })}
        className={`w-9 h-[18px] rounded-full border p-[2px] relative flex items-center transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary ${triggerTrackClass} ${
          disabled || loading
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-foreground/25 active:scale-[0.97]'
        }`}
      >
        {loading ? (
          <span className="w-full flex items-center justify-center">
            <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <span
            className={`relative z-10 w-3 h-3 rounded-full transition-transform duration-200 ease-out flex items-center justify-center ${thumbColorClass} ${thumbTranslate}`}
          >
            {mode === 'egress' ? (
              clampedValue === 1 ? (
                <Globe className="w-2 h-2 text-background" />
              ) : clampedValue === 2 ? (
                <Shield className="w-2 h-2 text-background" />
              ) : null
            ) : clampedValue === 2 ? (
              <Globe className="w-2 h-2 text-background" />
            ) : null}
          </span>
        )}
      </button>

      {/* Compact single-row segmented pill popover */}
      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="radiogroup"
            aria-label={accessibleStateLabel}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className={`fixed z-[60] bg-popover/95 backdrop-blur-sm border border-border/80 shadow-md rounded-lg p-0.5 flex items-center gap-0.5 animate-in fade-in zoom-in-95 duration-150 ${
              coords.placement === 'bottom'
                ? 'slide-in-from-top-1'
                : 'slide-in-from-bottom-1'
            }`}
          >
            {steps.map((step) => {
              const isLocked = isStepLocked(step.value)
              const isActive = clampedValue === step.value
              return (
                <button
                  key={step.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-disabled={isLocked}
                  onClick={() => handleSelectStep(step.value)}
                  className={`h-6 px-2 rounded-md text-[11px] leading-none whitespace-nowrap transition-colors duration-150 inline-flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    isLocked
                      ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                      : isActive
                        ? 'bg-secondary text-foreground font-medium shadow-xs cursor-pointer'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 cursor-pointer'
                  }`}
                >
                  {isActive && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStepDotClass(step.value, mode)}`}
                    />
                  )}
                  <span>{step.label}</span>
                  {isLocked && <Lock className="w-2.5 h-2.5 opacity-75" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
