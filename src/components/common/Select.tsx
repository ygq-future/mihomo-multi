import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption<T = string | number> {
  value: T
  label: string
  icon?: React.ReactNode
  description?: string
  disabled?: boolean
  rightNode?: React.ReactNode
}

export interface SelectProps<T = string | number> {
  id?: string
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  width?: string
  prefixIcon?: React.ReactNode
}

interface DropdownPosition {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
  maxHeight: number
}

export function Select<T extends string | number = string | number>({
  id,
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  className = '',
  width = 'w-full',
  prefixIcon,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const estimatedHeight = Math.min(options.length * 36 + 12, 240)

    const shouldPlaceTop =
      spaceBelow < estimatedHeight && spaceAbove > spaceBelow

    const top = shouldPlaceTop
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4

    const maxHeight = shouldPlaceTop
      ? Math.min(spaceAbove - 12, 240)
      : Math.min(spaceBelow - 12, 240)

    setPosition({
      top,
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - rect.width - 8),
      ),
      width: rect.width,
      placement: shouldPlaceTop ? 'top' : 'bottom',
      maxHeight: Math.max(120, maxHeight),
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) return

    const handleScrollOrResize = () => {
      updatePosition()
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return
      }
      setIsOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, updatePosition])

  return (
    <div className={`relative ${width} ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background border text-xs text-foreground hover:border-primary/50 focus:outline-none transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none text-left ${
          isOpen ? 'border-primary ring-2 ring-primary/20' : 'border-border'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {prefixIcon || selectedOption?.icon}
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

      {/* Portal Dropdown Menu Panel */}
      {isOpen &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
              zIndex: 99999,
            }}
            className={`p-1 bg-card border border-border rounded-xl shadow-2xl overflow-y-auto ${
              position.placement === 'top'
                ? 'animate-in fade-in slide-in-from-bottom-2 duration-150'
                : 'animate-in fade-in slide-in-from-top-2 duration-150'
            }`}
          >
            <div className="space-y-0.5">
              {options.map((opt) => {
                const isSelected = opt.value === value
                const isDisabled = opt.disabled ?? false
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (!isDisabled) {
                        onChange(opt.value)
                        setIsOpen(false)
                      }
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                      isDisabled
                        ? 'opacity-40 cursor-not-allowed text-muted-foreground select-none'
                        : isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                      {opt.icon}
                      <div className="truncate flex-1">
                        <div className="truncate">{opt.label}</div>
                        {opt.description && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {opt.rightNode}
                      {isSelected && !opt.rightNode && (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
