import { Check, ChevronDown, Search, X } from 'lucide-react'
import type React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface MultiSelectOption<T = string> {
  value: T
  label: string
  icon?: React.ReactNode
  description?: string
  disabled?: boolean
  badge?: React.ReactNode
}

export interface MultiSelectProps<T = string> {
  id?: string
  values: T[]
  onChange: (values: T[]) => void
  options: MultiSelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  width?: string
  prefixIcon?: React.ReactNode
  filterable?: boolean
  selectAllText?: string
  clearAllText?: string
  invertText?: string
  noDataText?: string
  /** 自定义触发器标签显示 */
  renderTriggerText?: (
    selectedValues: T[],
    selectedOptions: MultiSelectOption<T>[],
  ) => string
}

interface DropdownPosition {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
  maxHeight: number
}

export function MultiSelect<T extends string | number = string>({
  id,
  values,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  className = '',
  width = 'w-full',
  prefixIcon,
  filterable = true,
  selectAllText = '全选',
  clearAllText = '清空',
  invertText = '反选',
  noDataText = '无匹配选项',
  renderTriggerText,
}: MultiSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [position, setPosition] = useState<DropdownPosition | null>(null)

  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const selectedSet = useMemo(() => new Set(values), [values])

  const selectedOptions = useMemo(() => {
    return options.filter((opt) => selectedSet.has(opt.value))
  }, [options, selectedSet])

  const triggerText = useMemo(() => {
    if (renderTriggerText) {
      return renderTriggerText(values, selectedOptions)
    }
    if (selectedOptions.length === 0) {
      return placeholder
    }
    if (selectedOptions.length === options.length && options.length > 0) {
      return `全部 (${options.length})`
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0].label
    }
    return `已选 ${selectedOptions.length} 项`
  }, [renderTriggerText, values, selectedOptions, options.length, placeholder])

  const openDropdown = useCallback(() => {
    if (disabled) return
    clearTimeout(closeTimerRef.current as NodeJS.Timeout)
    closeTimerRef.current = null
    setIsClosing(false)
    setIsOpen(true)
    setSearchQuery('')
    setHighlightedIndex(-1)
  }, [disabled])

  const closeDropdown = useCallback(() => {
    if (isClosing || !isOpen) return
    setIsClosing(true)
    clearTimeout(closeTimerRef.current as NodeJS.Timeout)
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      closeTimerRef.current = null
    }, 120)
  }, [isClosing, isOpen])

  useEffect(() => {
    return () => {
      clearTimeout(closeTimerRef.current as NodeJS.Timeout)
    }
  }, [])

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!filterable || !q) {
      return options
    }
    return options.filter((opt) => {
      const labelMatch = opt.label.toLowerCase().includes(q)
      const descMatch = opt.description?.toLowerCase().includes(q)
      return labelMatch || Boolean(descMatch)
    })
  }, [options, filterable, searchQuery])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const estimatedHeight = Math.min(
      filteredOptions.length * 36 +
        (filterable && options.length > 4 ? 76 : 38),
      320,
    )

    const shouldPlaceTop =
      spaceBelow < estimatedHeight && spaceAbove > spaceBelow

    const top = shouldPlaceTop
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4

    const maxHeight = shouldPlaceTop
      ? Math.min(spaceAbove - 12, 360)
      : Math.min(spaceBelow - 12, 360)

    const dropdownWidth = rect.width

    setPosition({
      top,
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - dropdownWidth - 8),
      ),
      width: dropdownWidth,
      placement: shouldPlaceTop ? 'top' : 'bottom',
      maxHeight: Math.max(140, maxHeight),
    })
  }, [filteredOptions.length, filterable, options.length])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (isOpen && filterable) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 30)
      return () => clearTimeout(timer)
    }
  }, [isOpen, filterable])

  useEffect(() => {
    if (!isOpen && !isClosing) return

    const handleScrollOrResize = (e: Event) => {
      if (
        e.type === 'scroll' &&
        dropdownRef.current &&
        dropdownRef.current.contains(e.target as Node)
      ) {
        return
      }
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
      closeDropdown()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDropdown()
      }
    }

    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isClosing, updatePosition, closeDropdown])

  const toggleOption = (val: T) => {
    if (selectedSet.has(val)) {
      onChange(values.filter((v) => v !== val))
    } else {
      onChange([...values, val])
    }
  }

  const handleSelectAll = () => {
    const enabledValues = options
      .filter((opt) => !opt.disabled)
      .map((opt) => opt.value)
    onChange(enabledValues)
  }

  const handleClearAll = () => {
    onChange([])
  }

  const handleInvert = () => {
    const inverted = options
      .filter((opt) => !opt.disabled && !selectedSet.has(opt.value))
      .map((opt) => opt.value)
    onChange(inverted)
  }

  const enabledIndices = useMemo(() => {
    const list: number[] = []
    filteredOptions.forEach((opt, idx) => {
      if (!opt.disabled) list.push(idx)
    })
    return list
  }, [filteredOptions])

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (enabledIndices.length === 0) return
      const currentPos = enabledIndices.indexOf(highlightedIndex)
      const nextPos =
        currentPos === -1 || currentPos >= enabledIndices.length - 1
          ? 0
          : currentPos + 1
      setHighlightedIndex(enabledIndices[nextPos])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (enabledIndices.length === 0) return
      const currentPos = enabledIndices.indexOf(highlightedIndex)
      const prevPos =
        currentPos <= 0 ? enabledIndices.length - 1 : currentPos - 1
      setHighlightedIndex(enabledIndices[prevPos])
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault()
        const opt = filteredOptions[highlightedIndex]
        if (!opt.disabled) {
          toggleOption(opt.value)
        }
      }
    }
  }

  return (
    <div className={`relative ${width} ${className}`}>
      {/* Trigger Container */}
      <button
        type="button"
        ref={triggerRef as unknown as React.RefObject<HTMLButtonElement>}
        id={id}
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeDropdown()
          } else {
            openDropdown()
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full h-9 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background border text-xs text-foreground hover:border-primary/50 transition-colors duration-150 select-none ${
          disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
        } ${isOpen && !isClosing ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          {prefixIcon}
          <span
            className={`truncate ${
              selectedOptions.length === 0
                ? 'text-muted-foreground'
                : 'text-foreground font-medium'
            }`}
          >
            {triggerText}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {selectedOptions.length > 0 && !disabled && (
            <span className="px-1.5 py-0.2 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
              {selectedOptions.length}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
              isOpen && !isClosing ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Portal Dropdown Menu Panel */}
      {(isOpen || isClosing) &&
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
            className={`flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden ${
              isClosing
                ? position.placement === 'top'
                  ? 'animate-dropdown-exit-top pointer-events-none'
                  : 'animate-dropdown-exit-bottom pointer-events-none'
                : position.placement === 'top'
                  ? 'animate-dropdown-enter-top'
                  : 'animate-dropdown-enter-bottom'
            }`}
          >
            {/* Search Input */}
            {filterable && options.length > 4 && (
              <div className="p-2 border-b border-border/60 shrink-0">
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleListKeyDown}
                    placeholder="搜索选项..."
                    className="w-full bg-background border border-input rounded-md pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Action Bar (Select All / Invert / Clear) */}
            <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border/50 text-[11px] shrink-0">
              <span className="text-muted-foreground">
                已选{' '}
                <span className="text-foreground font-medium">
                  {selectedOptions.length}
                </span>
                /{options.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={selectedOptions.length === options.length}
                  className="text-primary hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                >
                  {selectAllText}
                </button>
                <span className="text-border/60">·</span>
                <button
                  type="button"
                  onClick={handleInvert}
                  className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                >
                  {invertText}
                </button>
                <span className="text-border/60">·</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={selectedOptions.length === 0}
                  className="text-muted-foreground hover:text-destructive hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                >
                  {clearAllText}
                </button>
              </div>
            </div>

            {/* Options List */}
            <div className="p-1.5 overflow-y-auto space-y-1.5 flex-1 min-h-0">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, idx) => {
                  const isSelected = selectedSet.has(opt.value)
                  const isDisabled = opt.disabled ?? false
                  const isHighlighted = !isDisabled && highlightedIndex === idx

                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        if (!isDisabled) {
                          toggleOption(opt.value)
                        }
                      }}
                      onMouseEnter={() => {
                        if (!isDisabled) {
                          setHighlightedIndex(idx)
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left cursor-pointer ${
                        isDisabled
                          ? 'opacity-40 cursor-not-allowed text-muted-foreground select-none'
                          : isSelected
                            ? isHighlighted
                              ? 'bg-primary/20 text-primary font-medium ring-1 ring-primary/40'
                              : 'bg-primary/10 text-primary font-medium ring-1 ring-primary/25'
                            : isHighlighted
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                        {opt.icon}
                        <div className="truncate flex-1">
                          <div className="truncate font-medium leading-tight">
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {opt.badge && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-normal">
                            {opt.badge}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                        )}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="py-6 px-3 text-center text-xs text-muted-foreground select-none">
                  {noDataText}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
