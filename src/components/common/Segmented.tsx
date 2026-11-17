import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

export interface SegmentedOption<T = string> {
  value: T
  label: string
  icon?: React.ReactNode
}

export interface SegmentedProps<T = string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

export function Segmented<T extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  disabled = false,
  className = '',
}: SegmentedProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const selected = container.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      )
      if (!selected) {
        setIndicator(null)
        return
      }
      const next = {
        left: selected.offsetLeft,
        top: selected.offsetTop,
        width: selected.offsetWidth,
        height: selected.offsetHeight,
      }
      setIndicator((previous) =>
        previous &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const button of container.querySelectorAll('button')) {
      observer.observe(button)
    }
    return () => observer.disconnect()
  }, [value, options])

  const sizeStyles = {
    sm: 'p-0.5 text-xs',
    md: 'p-1 text-xs',
  }

  const buttonSizeStyles = {
    sm: 'px-2.5 py-1 gap-1.5',
    md: 'px-3 py-1.5 gap-2',
  }

  return (
    <div
      ref={containerRef}
      className={`relative isolate inline-flex items-center bg-secondary/60 rounded-xl border border-border/80 ${sizeStyles[size]} ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      } ${className}`}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 rounded-lg border border-border/80 bg-card dark:bg-white/12 dark:border-white/10 motion-safe:transition-[transform,width,height] motion-safe:duration-200 motion-safe:ease-out"
          style={{
            transform: `translateX(${indicator.left}px) translateY(${indicator.top}px)`,
            width: indicator.width,
            height: indicator.height,
          }}
        />
      )}
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex items-center justify-center font-medium rounded-lg border border-transparent whitespace-nowrap transition-colors duration-150 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
              buttonSizeStyles[size]
            } ${
              isSelected
                ? 'text-foreground dark:text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
            }`}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
