import { Check, ChevronDown, X } from 'lucide-react'
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
  /** 可选所属分组/订阅组名称，用于两段式搜索 */
  group?: string
  /** 可选原始目标名称（不带分组前缀），用于无空格搜索时排除订阅组干扰 */
  searchTarget?: string
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
  clearable?: boolean
  onClear?: () => void
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
 * 搜索文本标准化：仅将 Unicode 区域指示字符（国旗 Emoji，如 🇭🇰 / 🇸🇬 / 🇯🇵）
 * 换算还原为对应 ASCII 大写字母（HK / SG / JP 等），严格保留原有字符大小写。
 */
function normalizeEmojiToAscii(text: string): string {
  return text.replace(/[\uD83C][\uDDE6-\uDDFF]/g, (m) => {
    const codePoint = m.codePointAt(0) ?? 0
    return String.fromCharCode(codePoint - 0x1f1e6 + 65)
  })
}

/**
 * 跳字子序列模糊匹配（不区分大小写）
 * target: 目标文本
 * query: 搜索词
 */
function fuzzySubsequenceMatch(target: string, query: string): boolean {
  if (!query) return true
  const lowerTarget = target.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let qIdx = 0
  for (let i = 0; i < lowerTarget.length && qIdx < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[qIdx]) {
      qIdx++
    }
  }
  return qIdx === lowerQuery.length
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
  clearable = false,
  onClear,
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
    const trimmed = searchQuery.trimStart()
    if (!filterable || !trimmed) {
      return options
    }

    // 1. 无空格：单段搜索，只匹配节点名称，排除订阅组，不区分大小写
    if (!trimmed.includes(' ')) {
      const q = normalizeEmojiToAscii(trimmed).toLowerCase()
      return options.filter((opt) => {
        let nodeName = opt.searchTarget || ''
        if (!nodeName) {
          const match = opt.label.match(/^\[(.*?)\]\s*(.*)$/)
          nodeName = match ? match[2] : opt.label
        }

        const normalizedTarget = normalizeEmojiToAscii(nodeName).toLowerCase()
        if (
          normalizedTarget.includes(q) ||
          fuzzySubsequenceMatch(normalizedTarget, q)
        ) {
          return true
        }
        if (opt.description?.toLowerCase().includes(q)) {
          return true
        }
        return false
      })
    }

    // 2. 有空格：两段式搜索模式
    const parts = trimmed.split(' ').filter(Boolean)
    if (parts.length === 0) {
      return options
    }
    // 限制只能两段，多于两段则不匹配，防止混淆
    if (parts.length > 2) {
      return []
    }

    const [groupQueryRaw, nodeQueryRaw] = parts
    const groupQ = normalizeEmojiToAscii(groupQueryRaw).toLowerCase()
    const nodeQ = nodeQueryRaw
      ? normalizeEmojiToAscii(nodeQueryRaw).toLowerCase()
      : ''

    return options.filter((opt) => {
      let groupName = opt.group || ''
      let nodeName = opt.searchTarget || ''

      if (!groupName || !nodeName) {
        const match = opt.label.match(/^\[(.*?)\]\s*(.*)$/)
        if (match) {
          if (!groupName) groupName = match[1]
          if (!nodeName) nodeName = match[2]
        } else {
          nodeName = opt.label
        }
      }

      const normalizedGroupName = normalizeEmojiToAscii(groupName).toLowerCase()
      const normalizedNodeName = normalizeEmojiToAscii(nodeName).toLowerCase()

      // 第一段匹配订阅组（模糊跳字匹配，如 mj 匹配 mojie）
      const matchGroup =
        normalizedGroupName.includes(groupQ) ||
        fuzzySubsequenceMatch(normalizedGroupName, groupQ)

      if (!matchGroup) return false

      // 若第二段尚未输入（如 "mojie "），则展示该订阅组下所有节点
      if (!nodeQ) return true

      // 第二段匹配节点名称
      const matchNode =
        normalizedNodeName.includes(nodeQ) ||
        fuzzySubsequenceMatch(normalizedNodeName, nodeQ) ||
        Boolean(opt.description?.toLowerCase().includes(nodeQ))

      return matchNode
    })
  }, [options, filterable, searchQuery])

  // 所有未被禁用的有效选项下标
  const enabledIndices = useMemo(() => {
    return filteredOptions
      .map((opt, idx) => (!opt.disabled ? idx : -1))
      .filter((idx) => idx !== -1)
  }, [filteredOptions])

  // 当前已选中项的下标
  const selectedIndex = useMemo(() => {
    return filteredOptions.findIndex(
      (opt) => opt.value === value && !opt.disabled,
    )
  }, [filteredOptions, value])

  const scrollToOption = useCallback((index: number) => {
    if (index >= 0 && dropdownRef.current) {
      const el = dropdownRef.current.querySelector(
        `[data-option-index="${index}"]`,
      )
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [])

  const prevIsOpenRef = useRef(false)
  const prevSearchQueryRef = useRef(searchQuery)

  // 仅在初次展开下拉框或搜索过滤词改变时同步初始高亮与滚动
  // 避免外部 options 静默刷新导致滚动位置被重置回首项
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false
      setHighlightedIndex(-1)
      return
    }

    const isJustOpened = !prevIsOpenRef.current
    const isSearchChanged = prevSearchQueryRef.current !== searchQuery
    prevIsOpenRef.current = true
    prevSearchQueryRef.current = searchQuery

    if (isJustOpened) {
      const targetIndex =
        selectedIndex >= 0 ? selectedIndex : (enabledIndices[0] ?? -1)
      setHighlightedIndex(targetIndex)
      if (targetIndex >= 0) {
        scrollToOption(targetIndex)
      }
    } else if (isSearchChanged) {
      const firstMatch = enabledIndices[0] ?? -1
      setHighlightedIndex(firstMatch)
      if (firstMatch >= 0) {
        scrollToOption(firstMatch)
      }
    } else {
      // 下拉框已处于打开状态且搜索词未变（如外部轮询刷新节点选项时）：保持已有高亮，严禁重置滚动
      setHighlightedIndex((prev) => {
        if (
          prev >= 0 &&
          prev < filteredOptions.length &&
          !filteredOptions[prev].disabled
        ) {
          return prev
        }
        return enabledIndices.length > 0 ? enabledIndices[0] : -1
      })
    }
  }, [
    isOpen,
    searchQuery,
    selectedIndex,
    enabledIndices,
    filteredOptions,
    scrollToOption,
  ])
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

    const handleScrollOrResize = (e: Event) => {
      // 若滚动源来自于下拉菜单容器本身，则无需重算挂载位置与重渲染
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
      const nextIndex = enabledIndices[nextPos]
      setHighlightedIndex(nextIndex)
      scrollToOption(nextIndex)
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
      const prevIndex = enabledIndices[prevPos]
      setHighlightedIndex(prevIndex)
      scrollToOption(prevIndex)
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

        <div className="flex items-center gap-1 shrink-0">
          {clearable && value && !disabled && (
            <button
              type="button"
              aria-label="清空选项"
              onClick={(e) => {
                e.stopPropagation()
                setSearchQuery('')
                if (onClear) {
                  onClear()
                } else {
                  onChange('' as unknown as T)
                }
              }}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
              isOpen && !isClosing ? 'rotate-180' : ''
            }`}
          />
        </div>
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
