import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  id?: string
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className = '',
  id,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const clampValue = useCallback(
    (val: number) => {
      const stepped = Math.round((val - min) / step) * step + min
      const precision = step.toString().split('.')[1]?.length || 0
      const rounded = Number(stepped.toFixed(precision))
      return Math.max(min, Math.min(max, rounded))
    },
    [min, max, step],
  )

  const getValueFromPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return value
      const rect = trackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return value
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = min + ratio * (max - min)
      return clampValue(raw)
    },
    [min, max, clampValue, value],
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    const nextVal = getValueFromPointer(e.clientX)
    if (nextVal !== value) {
      onChange(nextVal)
    }
  }

  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (e: PointerEvent) => {
      const nextVal = getValueFromPointer(e.clientX)
      onChange(nextVal)
    }

    const handlePointerUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isDragging, getValueFromPointer, onChange])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    let delta = 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      delta = step
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      delta = -step
    } else if (e.key === 'Home') {
      onChange(min)
      return
    } else if (e.key === 'End') {
      onChange(max)
      return
    }

    if (delta !== 0) {
      e.preventDefault()
      onChange(clampValue(value + delta))
    }
  }

  const range = max - min
  const percentage =
    range <= 0 ? 0 : Math.max(0, Math.min(100, ((value - min) / range) * 100))

  return (
    <div
      id={id}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      className={`relative h-5 flex items-center select-none touch-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer group'
      } ${className}`}
    >
      {/* Track Base */}
      <div
        ref={trackRef}
        className="relative w-full h-1.5 rounded-full bg-muted-foreground/20 dark:bg-muted-foreground/30 overflow-hidden"
      >
        {/* Active Fill */}
        <div
          className={`absolute left-0 top-0 bottom-0 bg-primary rounded-full ${
            isDragging ? '' : 'transition-[width] duration-100 ease-out'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Thumb Handle */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border border-black/10 dark:border-white/20 shadow-md pointer-events-none transition-transform ${
          isDragging
            ? 'scale-125 shadow-lg'
            : 'group-hover:scale-110 group-active:scale-95'
        }`}
        style={{
          left: `${percentage}%`,
          transition: isDragging
            ? 'none'
            : 'left 100ms ease-out, transform 150ms ease-out',
        }}
      />
    </div>
  )
}
