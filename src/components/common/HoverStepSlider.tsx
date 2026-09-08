import { Globe, Loader2, Power } from 'lucide-react'
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface StepItem {
  value: number
  label: string
}

export interface HoverStepSliderProps {
  value: number // 0, 1, 2
  onChange: (value: number) => void
  steps?: StepItem[]
  disabled?: boolean
  loading?: boolean
  className?: string
}

const defaultSteps: StepItem[] = [
  { value: 0, label: '禁用' },
  { value: 1, label: '监听' },
  { value: 2, label: '系统代理' },
]

// Theme RGB Colors for Smooth Linear Interpolation
// Level 0: Slate 400 (Off) - clean soft silver-gray
const COLOR_OFF = [148, 163, 184] as const
// Level 1: Emerald 400 (Listening) - radiant vivid emerald green
const COLOR_LISTEN = [16, 204, 138] as const
// Level 2: Sky 400 (System Proxy) - brilliant vivid cyan-sky blue
const COLOR_SYS = [14, 182, 255] as const

function interpolateColor(val: number): string {
  let r: number
  let g: number
  let b: number

  if (val <= 1) {
    const t = Math.max(0, Math.min(1, val))
    r = Math.round(COLOR_OFF[0] + (COLOR_LISTEN[0] - COLOR_OFF[0]) * t)
    g = Math.round(COLOR_OFF[1] + (COLOR_LISTEN[1] - COLOR_OFF[1]) * t)
    b = Math.round(COLOR_OFF[2] + (COLOR_LISTEN[2] - COLOR_OFF[2]) * t)
  } else {
    const t = Math.max(0, Math.min(1, val - 1))
    r = Math.round(COLOR_LISTEN[0] + (COLOR_SYS[0] - COLOR_LISTEN[0]) * t)
    g = Math.round(COLOR_LISTEN[1] + (COLOR_SYS[1] - COLOR_LISTEN[1]) * t)
    b = Math.round(COLOR_LISTEN[2] + (COLOR_SYS[2] - COLOR_LISTEN[2]) * t)
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
  steps = defaultSteps,
  disabled = false,
  loading = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)

  // continuousValue is a float [0.0 ~ 2.0] used for butter-smooth visual drag
  const [continuousValue, setContinuousValue] = useState<number>(value)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
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

  const clearPendingTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popoverWidth = 164
    const popoverHeight = 78
    const gap = 10
    // Align right edge of popover with trigger's right edge
    let left = rect.right - popoverWidth
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
  }, [])

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
    isHoveredRef.current = true
    clearPendingTimer()
    updatePosition()
    setIsOpen(true)
  }, [clearPendingTimer, disabled, updatePosition])

  const handleMouseLeave = useCallback(
    (e?: ReactMouseEvent) => {
      if (isDraggingRef.current) return
      // If mouse is moving directly between trigger and popover, ignore
      if (e?.relatedTarget && isRelatedInside(e.relatedTarget)) {
        return
      }

      isHoveredRef.current = false
      clearPendingTimer()
      hoverTimerRef.current = window.setTimeout(() => {
        if (!isHoveredRef.current && !isDraggingRef.current) {
          setIsOpen(false)
        }
      }, 250)
    },
    [clearPendingTimer, isRelatedInside],
  )

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearPendingTimer()
    }
  }, [clearPendingTimer])
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
      const floatVal = ratio * maxStep
      setContinuousValue(floatVal)
      latestContinuousRef.current = floatVal
    },
    [maxStep],
  )

  const handleTrackMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || loading) return
    e.preventDefault()
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

    const handleMouseUp = () => {
      setIsDragging(false)
      isDraggingRef.current = false

      // Snap to nearest discrete step
      const snapped = Math.round(latestContinuousRef.current)
      const finalStep = Math.max(0, Math.min(maxStep, snapped))
      setContinuousValue(finalStep)
      latestContinuousRef.current = finalStep

      if (finalStep !== committedValueRef.current) {
        committedValueRef.current = finalStep
        onChange(finalStep)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, maxStep, onChange, updateContinuousFromClientX])

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
    setContinuousValue(stepVal)
    latestContinuousRef.current = stepVal
    if (stepVal !== committedValueRef.current) {
      committedValueRef.current = stepVal
      onChange(stepVal)
    }
  }

  // Active color interpolation for current float value
  const activeColorRgb = interpolateColor(continuousValue)
  const currentNearestStepIndex = Math.round(continuousValue)
  const currentStep = steps[currentNearestStepIndex] ?? steps[0]

  // Normal switch indicator styles (compact 36px x 20px)
  const triggerBg =
    clampedPropValue === 0
      ? 'bg-secondary border-border/80'
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
            {clampedPropValue === 2 ? (
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
                  监听状态
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
                {steps.map((step) => (
                  <button
                    key={step.value}
                    type="button"
                    onClick={() => handleSelectStep(step.value)}
                    className={`hover:text-foreground transition-all cursor-pointer py-0.5 px-1 rounded font-medium leading-none ${
                      currentNearestStepIndex === step.value
                        ? 'font-bold text-foreground bg-secondary/90'
                        : ''
                    }`}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
