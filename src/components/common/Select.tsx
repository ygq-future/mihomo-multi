import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

export interface SelectOption<T = string | number> {
  value: T
  label: string
  icon?: React.ReactNode
  description?: string
}

export interface SelectProps<T = string | number> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  width?: string
}

export function Select<T extends string | number = string | number>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  className = '',
  width = 'w-full',
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className={`relative ${width} ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary transition-all disabled:opacity-50 disabled:pointer-events-none select-none text-left"
      >
        <div className="flex items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu Panel */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 p-1 bg-card border border-border rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-100 max-h-60 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                  isSelected
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  {opt.icon}
                  <div className="truncate">
                    <div className="truncate">{opt.label}</div>
                    {opt.description && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {opt.description}
                      </div>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
