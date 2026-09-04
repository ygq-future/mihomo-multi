import { Check, ChevronDown } from 'lucide-react'
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
  filterable?: boolean
  noDataText?: string
}

interface DropdownPosition {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
  maxHeight: number
}

/**
 * 跳字子序列模糊匹配（大小写不敏感）
 * target: 目标文本
 * query: 搜索词
 */
function fuzzySubsequenceMatch(target: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const t = target.toLowerCase()
  let qIdx = 0
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++
    }
  }
  return qIdx === q.length
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
  filterable = true,
  noDataText = '无匹配选项',
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  const openDropdown = useCallback(() => {
    if (disabled) return
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsClosing(false)
    setIsOpen(true)
    if (filterable) {
      setSearchQuery('')
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }, [disabled, filterable])

  const closeDropdown = useCallback(() => {
    if (isClosing || !isOpen) return
    setIsClosing(true)
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      closeTimerRef.current = null
    }, 120)
  }, [isClosing, isOpen])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const filteredOptions = useMemo(() => {
    if (!filterable || !searchQuery.trim()) {
      return options
    }
    return options.filter((opt) => {
      if (fuzzySubsequenceMatch(opt.label, searchQuery)) {
        return true
      }
      if (
        opt.description &&
        fuzzySubsequenceMatch(opt.description, searchQuery)
      ) {
        return true
      }
      return false
    })
  }, [options, filterable, searchQuery])

  // 所有未被禁用的有效选项下标
  const enabledIndices = useMemo(() => {
    return filteredOptions
      .map((opt, idx) => (!opt.disabled ? idx : -1))
      .filter((idx) => idx !== -1)
  }, [filteredOptions])

  // 打开下拉框或过滤项变化时，默认高亮第一个未禁用的选项
  useEffect(() => {
    if (isOpen) {
      if (enabledIndices.length > 0) {
        setHighlightedIndex(enabledIndices[0])
      } else {
        setHighlightedIndex(-1)
      }
    } else {
      setHighlightedIndex(-1)
    }
  }, [isOpen, enabledIndices])

  // 键盘导航切换高亮时，自动将高亮项滚动至可视区域内
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && dropdownRef.current) {
      const el = dropdownRef.current.querySelector(
        `[data-option-index="${highlightedIndex}"]`,
      )
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, highlightedIndex])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const contentCount = Math.max(filteredOptions.length, 1)
    const estimatedHeight = Math.min(contentCount * 36 + 12, 240)

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
  }, [filteredOptions.length])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (isOpen) {
      if (filterable) {
        const timer = setTimeout(() => {
          inputRef.current?.focus()
        }, 10)
        return () => clearTimeout(timer)
      }
    } else {
      setSearchQuery('')
    }
  }, [isOpen, filterable])

  useEffect(() => {
    if (!isOpen && !isClosing) return

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

  const handleContainerClick = (e: React.MouseEvent) => {
    if (disabled) return
    if (!isOpen || isClosing) {
      openDropdown()
    } else {
      // 若已展开且点击不是 input 本身（例如点击右侧箭头或边缘空白），则收起
      if (e.target !== inputRef.current) {
        closeDropdown()
      }
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeDropdown()
      inputRef.current?.blur()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        const targetOpt = filteredOptions[highlightedIndex]
        if (!targetOpt.disabled) {
          onChange(targetOpt.value)
          closeDropdown()
          setSearchQuery('')
          inputRef.current?.blur()
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen || isClosing) {
        openDropdown()
        return
      }
      if (enabledIndices.length === 0) return
      const currentPos = enabledIndices.indexOf(highlightedIndex)
      const nextPos =
        currentPos === -1 || currentPos >= enabledIndices.length - 1
          ? 0
          : currentPos + 1
      setHighlightedIndex(enabledIndices[nextPos])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen || isClosing) {
        openDropdown()
        return
      }
      if (enabledIndices.length === 0) return
      const currentPos = enabledIndices.indexOf(highlightedIndex)
      const prevPos =
        currentPos <= 0 ? enabledIndices.length - 1 : currentPos - 1
      setHighlightedIndex(enabledIndices[prevPos])
    }
  }

  return (
    <div className={`relative ${width} ${className}`}>
      {/* Trigger Container with in-place Filterable Input */}
      <div
        ref={triggerRef}
        id={id}
        onClick={handleContainerClick}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background border text-xs text-foreground hover:border-primary/50 transition-colors duration-150 select-none ${
          disabled
            ? 'opacity-50 pointer-events-none'
            : isOpen && !isClosing && filterable
              ? 'cursor-text'
              : 'cursor-pointer'
        } ${isOpen && !isClosing ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          {prefixIcon || selectedOption?.icon}
          <input
            ref={inputRef}
            type="text"
            disabled={disabled}
            readOnly={!isOpen || isClosing || !filterable}
            value={
              isOpen && !isClosing && filterable
                ? searchQuery
                : selectedOption
                  ? selectedOption.label
                  : ''
            }
            placeholder={
              isOpen && !isClosing && filterable
                ? selectedOption
                  ? selectedOption.label
                  : placeholder
                : placeholder
            }
            onChange={(e) => {
              if (isOpen && !isClosing && filterable) {
                setSearchQuery(e.target.value)
              }
            }}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground p-0 ${
              isOpen && !isClosing && filterable
                ? 'cursor-text'
                : 'cursor-pointer'
            }`}
          />
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
            isOpen && !isClosing ? 'rotate-180' : ''
          }`}
        />
      </div>

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
            className={`p-1 bg-card border border-border rounded-xl shadow-2xl overflow-y-auto ${
              isClosing
                ? position.placement === 'top'
                  ? 'animate-dropdown-exit-top pointer-events-none'
                  : 'animate-dropdown-exit-bottom pointer-events-none'
                : position.placement === 'top'
                  ? 'animate-dropdown-enter-top'
                  : 'animate-dropdown-enter-bottom'
            }`}
          >
            <div className="space-y-0.5">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value
                  const isDisabled = opt.disabled ?? false
                  const isHighlighted = !isDisabled && highlightedIndex === idx

                  return (
                    <button
                      key={String(opt.value)}
                      data-option-index={idx}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        if (!isDisabled) {
                          onChange(opt.value)
                          closeDropdown()
                          setSearchQuery('')
                        }
                      }}
                      onMouseEnter={() => {
                        if (!isDisabled) {
                          setHighlightedIndex(idx)
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                        isDisabled
                          ? 'opacity-40 cursor-not-allowed text-muted-foreground select-none'
                          : isSelected
                            ? isHighlighted
                              ? 'bg-primary/20 text-primary font-medium ring-1 ring-primary/40'
                              : 'bg-primary/10 text-primary font-medium'
                            : isHighlighted
                              ? 'bg-accent text-accent-foreground font-medium'
                              : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground'
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
