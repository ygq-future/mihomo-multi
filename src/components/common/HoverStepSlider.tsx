import { Globe, Loader2, Lock, Power, Shield } from 'lucide-react'
import { toast } from '../../stores/toastStore'
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
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
const defaultSteps: StepItem[] = [
  { value: 0, label: '禁用' },
  { value: 1, label: '监听' },
  { value: 2, label: '系统代理' },
]

let activeDraggingSliderId: string | null = null

// Theme RGB Colors for Smooth Linear Interpolation
// Port Mode: 0: Slate (Off) -> 1: Emerald (Listening) -> 2: Sky (System Proxy)
const PORT_COLOR_OFF = [148, 163, 184] as const
const PORT_COLOR_LISTEN = [16, 204, 138] as const
const PORT_COLOR_SYS = [14, 182, 255] as const

// Egress Mode: 0: Slate (Off) -> 1: Sky (System Proxy) -> 2: Emerald (TUN)
const EGRESS_COLOR_OFF = [148, 163, 184] as const
const EGRESS_COLOR_SYS = [14, 182, 255] as const
const EGRESS_COLOR_TUN = [16, 204, 138] as const

function interpolateColor(
  val: number,
  mode: HoverStepSliderMode = 'port',
): string {
  const c0 = mode === 'egress' ? EGRESS_COLOR_OFF : PORT_COLOR_OFF
  const c1 = mode === 'egress' ? EGRESS_COLOR_SYS : PORT_COLOR_LISTEN
  const c2 = mode === 'egress' ? EGRESS_COLOR_TUN : PORT_COLOR_SYS

  let r: number
  let g: number
  let b: number

  if (val <= 1) {
    const t = Math.max(0, Math.min(1, val))
    r = Math.round(c0[0] + (c1[0] - c0[0]) * t)
    g = Math.round(c0[1] + (c1[1] - c0[1]) * t)
    b = Math.round(c0[2] + (c1[2] - c0[2]) * t)
  } else {
    const t = Math.max(0, Math.min(1, val - 1))
    r = Math.round(c1[0] + (c2[0] - c1[0]) * t)
    g = Math.round(c1[1] + (c2[1] - c1[1]) * t)
    b = Math.round(c2[2] + (c2[2] - c1[2]) * t)
  }
  return `rgb(${r}, ${g}, ${b})`
}
interface Coords {
  top: number
  left: number
  placement: 'top' | 'bottom'
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
  headerTitle,
  mode = 'port',
  popoverAlign,
}) => {
  const instanceId = useId()
  const steps =
    customSteps ||
    (mode === 'egress'
      ? [
          { value: 0, label: '关闭' },
          { value: 1, label: '系统代理' },
          { value: 2, label: 'TUN' },
        ]
      : defaultSteps)
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)

  // continuousValue is a float [0.0 ~ 2.0] used for butter-smooth visual drag
  const [continuousValue, setContinuousValue] = useState<number>(value)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const isHoveredRef = useRef(false)
  const isDraggingRef = useRef(false)
  const latestContinuousRef = useRef(value)
  const committedValueRef = useRef(value)

  const maxStep = steps.length - 1
  const clampedPropValue = Math.max(0, Math.min(maxStep, value))

  // Sync prop value when NOT dragging and NOT during in-flight asynchronous loading
  useEffect(() => {
    if (isDraggingRef.current) return
    if (loading && clampedPropValue !== committedValueRef.current) {
      return
    }
    committedValueRef.current = clampedPropValue
    setContinuousValue(clampedPropValue)
    latestContinuousRef.current = clampedPropValue
  }, [clampedPropValue, loading])

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
    const popoverWidth = 164
    const popoverHeight = 78
    const gap = 10

    const effectiveAlign =
      popoverAlign ?? (mode === 'egress' ? 'left' : 'right')

    let left: number
    if (effectiveAlign === 'left') {
      left = rect.left
    } else if (effectiveAlign === 'center') {
      left = rect.left + rect.width / 2 - popoverWidth / 2
    } else if (effectiveAlign === 'right') {
      left = rect.right - popoverWidth
    } else {
      if (rect.left + popoverWidth <= window.innerWidth - 8) {
        left = rect.left
      } else {
        left = rect.right - popoverWidth
      }
    }

    if (left < 8) left = 8
    if (left + popoverWidth > window.innerWidth - 8) {
      left = window.innerWidth - popoverWidth - 8
    }

    // Default to 'top', fallback to 'bottom' if near top of window
    let top = rect.top - popoverHeight - gap
    let placement: 'top' | 'bottom' = 'top'

    if (top < 8) {
      top = rect.bottom + gap
      placement = 'bottom'
    }

    setCoords({ top, left, placement })
  }, [mode, popoverAlign])
  const isRelatedInside = useCallback(
    (relatedTarget: EventTarget | null): boolean => {
      if (!relatedTarget || !(relatedTarget instanceof Node)) return false
      if (triggerRef.current?.contains(relatedTarget)) return true
      if (popoverRef.current?.contains(relatedTarget)) return true
      return false
    },
    [],
  )

  const handleMouseEnter = useCallback(() => {
    if (disabled) return
    if (activeDraggingSliderId && activeDraggingSliderId !== instanceId) return
    isHoveredRef.current = true
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    if (isOpen) return

    // Add a slight intentional delay (180ms) to prevent flickering on quick mouse pass-by
    if (enterTimerRef.current === null) {
      enterTimerRef.current = window.setTimeout(() => {
        if (isHoveredRef.current) {
          updatePosition()
          setIsOpen(true)
        }
        enterTimerRef.current = null
      }, 180)
    }
  }, [disabled, instanceId, isOpen, updatePosition])
  const handleMouseLeave = useCallback(
    (e?: ReactMouseEvent) => {
      if (isDraggingRef.current) return
      // If mouse is moving directly between trigger and popover, ignore
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
        if (!isHoveredRef.current && !isDraggingRef.current) {
          setIsOpen(false)
        }
        leaveTimerRef.current = null
      }, 200)
    },
    [isRelatedInside],
  )

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (activeDraggingSliderId === instanceId) {
        activeDraggingSliderId = null
      }
      clearPendingTimers()
    }
  }, [clearPendingTimers, instanceId])
  const updateContinuousFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      // In-track thumb width is 32px, padding is 2px
      const thumbHalfWidth = 16
      const pad = 2
      const innerWidth = rect.width - (thumbHalfWidth * 2 + pad * 2)
      if (innerWidth <= 0) return

      const rawOffset = clientX - (rect.left + pad + thumbHalfWidth)
      const ratio = Math.max(0, Math.min(1, rawOffset / innerWidth))
      const rawMax =
        maxAllowedStep !== undefined
          ? Math.min(maxAllowedStep, maxStep)
          : maxStep
      const floatVal = Math.min(rawMax, ratio * maxStep)
      setContinuousValue(floatVal)
      latestContinuousRef.current = floatVal
    },
    [maxStep, maxAllowedStep],
  )

  const handleTrackMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || loading) return
    e.preventDefault()
    activeDraggingSliderId = instanceId
    setIsDragging(true)
    isDraggingRef.current = true
    updateContinuousFromClientX(e.clientX)
  }
  // Global mousemove & mouseup during dragging
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      updateContinuousFromClientX(e.clientX)
    }

    const handleMouseUp = (e: globalThis.MouseEvent) => {
      if (activeDraggingSliderId === instanceId) {
        activeDraggingSliderId = null
      }
      setIsDragging(false)
      isDraggingRef.current = false

      // Snap to nearest discrete step
      const snapped = Math.round(latestContinuousRef.current)
      const rawMax =
        maxAllowedStep !== undefined
          ? Math.min(maxAllowedStep, maxStep)
          : maxStep
      const finalStep = Math.max(0, Math.min(rawMax, snapped))
      setContinuousValue(finalStep)
      latestContinuousRef.current = finalStep

      if (finalStep !== committedValueRef.current) {
        committedValueRef.current = finalStep
        onChange(finalStep)
      }

      // Check whether mouse cursor is still inside this slider's trigger or popover
      const targetEl = document.elementFromPoint(e.clientX, e.clientY)
      const isInside =
        (targetEl &&
          (triggerRef.current?.contains(targetEl) ||
            popoverRef.current?.contains(targetEl))) ??
        false

      if (!isInside) {
        isHoveredRef.current = false
        if (enterTimerRef.current !== null) {
          window.clearTimeout(enterTimerRef.current)
          enterTimerRef.current = null
        }
        if (leaveTimerRef.current !== null) {
          window.clearTimeout(leaveTimerRef.current)
        }
        leaveTimerRef.current = window.setTimeout(() => {
          if (!isHoveredRef.current && !isDraggingRef.current) {
            setIsOpen(false)
          }
          leaveTimerRef.current = null
        }, 150)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    instanceId,
    isDragging,
    maxStep,
    maxAllowedStep,
    onChange,
    updateContinuousFromClientX,
  ])

  // Update coords on window resize or scroll
  useEffect(() => {
    if (!isOpen) return
    const handleScrollOrResize = () => {
      if (!isDraggingRef.current) {
        updatePosition()
      }
    }
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen, updatePosition])

  // Click on step tag
  const handleSelectStep = (stepVal: number) => {
    if (disabled || loading) return
    const isLocked =
      lockedSteps?.includes(stepVal) ||
      (maxAllowedStep !== undefined && stepVal > maxAllowedStep)
    if (isLocked) {
      toast.warning(
        lockedTooltip || '直连监听不支持设为系统代理，仅供应用/插件定向直通',
      )
      return
    }
    setContinuousValue(stepVal)
    latestContinuousRef.current = stepVal
    if (stepVal !== committedValueRef.current) {
      committedValueRef.current = stepVal
      onChange(stepVal)
    }
  }

  // Active color interpolation for current float value
  const activeColorRgb = interpolateColor(continuousValue, mode)
  const currentNearestStepIndex = Math.round(continuousValue)
  const currentStep = steps[currentNearestStepIndex] ?? steps[0]

  // Normal switch indicator styles (compact 36px x 20px)
  const triggerBg =
    clampedPropValue === 0
      ? 'bg-secondary border-border/80'
      : mode === 'egress'
        ? clampedPropValue === 1
          ? 'bg-sky-500/25 border-sky-500/50 text-sky-600 dark:text-sky-400'
          : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
        : clampedPropValue === 1
          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          : 'bg-sky-500/25 border-sky-500/50 text-sky-600 dark:text-sky-400'

  const thumbPosition =
    clampedPropValue === 0
      ? 'left-0.5'
      : clampedPropValue === 1
        ? 'left-[10px]'
        : 'left-[20px]'

  const thumbColor =
    clampedPropValue === 0
      ? 'bg-muted-foreground/60'
      : mode === 'egress'
        ? clampedPropValue === 1
          ? 'bg-sky-500 shadow-sm shadow-sky-500/50'
          : 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
        : clampedPropValue === 1
          ? 'bg-emerald-500 shadow-sm'
          : 'bg-sky-500 shadow-sm shadow-sky-500/50'
  return (
    <div
      className={`relative inline-flex items-center select-none ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger Capsule: Strictly 36px x 20px (matches standard Switch) */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || loading}
        onClick={() => {
          const next = clampedPropValue === 0 ? 1 : 0
          handleSelectStep(next)
        }}
        className={`w-9 h-5 rounded-full border transition-all duration-200 relative flex items-center p-0.5 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary ${triggerBg} ${
          disabled || loading
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:brightness-105 active:scale-95'
        }`}
        title={`当前状态: ${currentStep.label} (悬停展开滑块自由调节)`}
      >
        {loading ? (
          <span className="w-full flex items-center justify-center">
            <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <span
            className={`absolute top-0.5 bottom-0.5 w-3.5 h-3.5 rounded-full transition-all duration-200 flex items-center justify-center ${thumbPosition} ${thumbColor}`}
          >
            {mode === 'egress' ? (
              clampedPropValue === 1 ? (
                <Globe className="w-2 h-2 text-white" />
              ) : clampedPropValue === 2 ? (
                <Shield className="w-2 h-2 text-white" />
              ) : (
                <Power className="w-2 h-2 text-background/80" />
              )
            ) : clampedPropValue === 2 ? (
              <Globe className="w-2 h-2 text-white" />
            ) : clampedPropValue === 0 ? (
              <Power className="w-2 h-2 text-background/80" />
            ) : null}
          </span>
        )}
      </button>

      {/* Floating Stepper Popup via Portal: ultra-compact & tight padding */}
      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className={`fixed z-[9999] animate-in fade-in zoom-in-95 duration-150 ${
              coords.placement === 'top'
                ? 'slide-in-from-bottom-2'
                : 'slide-in-from-top-2'
            }`}
          >
            <div className="bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-xl p-2 w-[164px] flex flex-col gap-1.5 ring-1 ring-black/10 dark:ring-white/10">
              {/* Header: Micro status badge */}
              <div className="flex items-center justify-between px-0.5">
                <span className="text-muted-foreground font-medium text-[10px]">
                  {headerTitle || (mode === 'egress' ? '接管模式' : '监听状态')}
                </span>
                <span
                  className="font-bold text-[10px] px-1 py-0.2 rounded leading-tight transition-colors duration-75"
                  style={{
                    color: activeColorRgb,
                    backgroundColor: `${activeColorRgb.replace('rgb', 'rgba').replace(')', ', 0.12)')}`,
                  }}
                >
                  {currentStep.label}
                </span>
              </div>

              {/* Substantial Track (h-7) with IN-TRACK thumb (no overflow, no dot clutter) */}
              <div
                ref={trackRef}
                onMouseDown={handleTrackMouseDown}
                className="relative w-full h-7 bg-secondary/80 rounded-lg p-0.5 flex items-center cursor-pointer overflow-hidden border border-border/60 shadow-inner"
              >
                {/* Background active color fill layer (vibrant & fully stretches to right edge) */}
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-lg transition-all shadow-xs"
                  style={{
                    width: `calc(18px + ${continuousValue / maxStep} * (100% - 18px))`,
                    backgroundColor: activeColorRgb,
                    opacity: 0.65,
                    transition: isDragging ? 'none' : 'width 0.2s ease-out',
                  }}
                />
                {/* In-Track Sliding Thumb (h-6 w-8, strictly inside track bounds) */}
                <div
                  className="absolute top-0.5 bottom-0.5 w-8 rounded-md bg-background shadow-sm border border-border/90 flex items-center justify-center pointer-events-none"
                  style={{
                    left: `calc(2px + ${continuousValue / maxStep} * (100% - 36px))`,
                    transition: isDragging
                      ? 'none'
                      : 'left 0.2s ease-out, background-color 0.15s ease',
                  }}
                >
                  {/* Subtle color bar inside the in-track thumb */}
                  <div
                    className="w-3.5 h-1 rounded-full transition-colors duration-75"
                    style={{ backgroundColor: activeColorRgb }}
                  />
                </div>
              </div>

              {/* Clickable Step Tags */}
              <div className="flex justify-between items-center text-[10px] text-muted-foreground px-0.5">
                {steps.map((step) => {
                  const isLocked =
                    lockedSteps?.includes(step.value) ||
                    (maxAllowedStep !== undefined &&
                      step.value > maxAllowedStep)
                  return (
                    <button
                      key={step.value}
                      type="button"
                      onClick={() => handleSelectStep(step.value)}
                      title={
                        isLocked
                          ? lockedTooltip || '直连监听不支持设为系统代理'
                          : undefined
                      }
                      className={`transition-all py-0.5 px-1 rounded font-medium leading-none flex items-center gap-0.5 ${
                        isLocked
                          ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                          : 'cursor-pointer hover:text-foreground'
                      } ${
                        currentNearestStepIndex === step.value
                          ? 'font-bold text-foreground bg-secondary/90'
                          : ''
                      }`}
                    >
                      {step.label}
                      {isLocked && (
                        <Lock className="w-2.5 h-2.5 ml-0.5 opacity-80" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
