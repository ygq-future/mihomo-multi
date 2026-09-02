import type React from 'react'

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
      className={`inline-flex items-center bg-secondary/60 rounded-xl border border-border/80 ${sizeStyles[size]} ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      } ${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex items-center justify-center font-medium rounded-lg whitespace-nowrap transition-all duration-150 select-none ${
              buttonSizeStyles[size]
            } ${
              isSelected
                ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/80'
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
