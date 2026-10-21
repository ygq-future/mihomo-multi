import { ChevronDown, Copy, Loader2, Terminal } from 'lucide-react'
import type React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { InboundProtocol } from '../../types'

export interface QuickCopyMenuProps {
  port: number
  protocol: InboundProtocol
  hostIp?: string
  bypassDomains?: string[]
  disabled?: boolean
  onCopySuccess: (text: string) => void
  isEnvProxy?: boolean
  onToggleEnvProxy?: () => Promise<void>
  isEnvProxyLoading?: boolean
}

export const QuickCopyMenu: React.FC<QuickCopyMenuProps> = ({
  port,
  protocol,
  hostIp,
  bypassDomains,
  disabled = false,
  onCopySuccess,
  isEnvProxy = false,
  onToggleEnvProxy,
  isEnvProxyLoading = false,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    placement: 'top' | 'bottom'
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const host = hostIp || '127.0.0.1'
  const openMenu = useCallback(() => {
    if (disabled) return
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsClosing(false)
    setIsOpen(true)
  }, [disabled])

  const closeMenu = useCallback(() => {
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

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const hasEnvRow = Boolean(onToggleEnvProxy)
    const menuHeight = 225 + (hasEnvRow ? 45 : 0)
    const shouldPlaceTop = spaceBelow < menuHeight && rect.top > menuHeight
    const top = shouldPlaceTop ? rect.top - menuHeight - 4 : rect.bottom + 4
    const left = Math.max(
      8,
      Math.min(rect.right - 232, window.innerWidth - 240),
    )

    setMenuPos({
      top,
      left,
      placement: shouldPlaceTop ? 'top' : 'bottom',
    })
  }, [onToggleEnvProxy])
  useLayoutEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
      setIsClosing(false)
      return
    }
    if (isOpen) {
      updatePos()
    }
  }, [disabled, isOpen, updatePos])

  useEffect(() => {
    if (!isOpen && !isClosing) return

    const handleEvents = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      closeMenu()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    document.addEventListener('mousedown', handleEvents, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      document.removeEventListener('mousedown', handleEvents, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isClosing, updatePos, closeMenu])

  const isWin =
    typeof navigator !== 'undefined' &&
    (/win/i.test(navigator.userAgent) ||
      /windows/i.test(navigator.platform || ''))

  const noProxyStr =
    bypassDomains && bypassDomains.length > 0
      ? bypassDomains.filter((d) => d.toLowerCase() !== '<local>').join(',')
      : 'localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'

  const httpProxyUrl = `http://${host}:${port}`
  const allProxyUrl =
    protocol === 'socks5'
      ? `socks5://${host}:${port}`
      : `http://${host}:${port}`

  const envCommand = isWin
    ? `$env:HTTP_PROXY="${httpProxyUrl}"; $env:HTTPS_PROXY="${httpProxyUrl}"; $env:ALL_PROXY="${allProxyUrl}"; $env:NO_PROXY="${noProxyStr}"`
    : `export http_proxy="${httpProxyUrl}"; export https_proxy="${httpProxyUrl}"; export all_proxy="${allProxyUrl}"; export no_proxy="${noProxyStr}"; export HTTP_PROXY="${httpProxyUrl}"; export HTTPS_PROXY="${httpProxyUrl}"; export ALL_PROXY="${allProxyUrl}"; export NO_PROXY="${noProxyStr}"`

  const copyOptions = [
    {
      label: isWin
        ? '终端环境变量命令 (PowerShell)'
        : '终端环境变量命令 (Shell export)',
      value: envCommand,
      desc: isWin
        ? '$env:HTTP_PROXY="http://..."'
        : 'export http_proxy=... (全大小写兼容)',
      icon: <Terminal className="w-3 h-3 text-primary" />,
    },
    {
      label: '纯地址 (Host:Port)',
      value: `${host}:${port}`,
      desc: `${host}:${port}`,
    },
    {
      label: 'HTTP 代理 URL',
      value: `http://${host}:${port}`,
      desc: `http://${host}:${port}`,
    },
    {
      label: 'SOCKS5 代理 URL',
      value: `socks5://${host}:${port}`,
      desc: `socks5://${host}:${port}`,
    },
    {
      label: 'cURL 出口 IP 探测命令',
      value: `curl -x ${protocol === 'socks5' ? 'socks5' : 'http'}://${host}:${port} -s https://api.ip.sb/geoip`,
      desc: '一键在终端测试该端口出口 IP',
      icon: <Terminal className="w-3 h-3 text-muted-foreground" />,
    },
  ]

  const handleCopy = (val: string, label: string) => {
    navigator.clipboard.writeText(val).catch(() => {})
    onCopySuccess(`已复制 ${label}: ${val}`)
    closeMenu()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (disabled) return
          if (!isOpen || isClosing) {
            openMenu()
          } else {
            closeMenu()
          }
        }}
        className={`p-1 rounded transition-colors flex items-center gap-0.5 ${
          disabled
            ? 'opacity-40 text-muted-foreground cursor-not-allowed pointer-events-none'
            : isEnvProxy
              ? 'text-primary bg-primary/10 hover:bg-primary/20 cursor-pointer'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer'
        }`}
        title={
          disabled
            ? '端口已禁用，无法复制或配置代理'
            : isEnvProxy
              ? '当前已设为全局终端代理出口 (点击管理/快捷复制)'
              : '终端代理与快捷复制'
        }
      >
        <Terminal className="w-3 h-3" />
        <ChevronDown
          className={`w-2.5 h-2.5 opacity-60 transition-transform duration-200 ${
            isOpen && !isClosing ? 'rotate-180' : ''
          }`}
        />
      </button>

      {(isOpen || isClosing) &&
        menuPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              width: '232px',
              zIndex: 99999,
            }}
            className={`p-1 bg-card border border-border rounded-xl shadow-2xl ${
              isClosing
                ? menuPos.placement === 'top'
                  ? 'animate-dropdown-exit-top pointer-events-none'
                  : 'animate-dropdown-exit-bottom pointer-events-none'
                : menuPos.placement === 'top'
                  ? 'animate-dropdown-enter-top'
                  : 'animate-dropdown-enter-bottom'
            }`}
          >
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/50 flex items-center justify-between">
              <span>快捷复制代理格式</span>
              <span className="font-mono text-[10px] text-primary font-normal">
                {host}
              </span>
            </div>
            {onToggleEnvProxy && (
              <div className="p-1 mb-0.5 rounded-lg bg-accent/40 border border-border/60 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Terminal
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isEnvProxy ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-foreground leading-tight flex items-center gap-1">
                      <span>终端环境变量</span>
                      {isEnvProxy && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-primary/20 text-primary font-mono font-normal">
                          当前出口
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {isEnvProxy ? '新开终端已生效' : '注入系统环境变量'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isEnvProxyLoading || disabled}
                  onClick={async (e) => {
                    e.stopPropagation()
                    await onToggleEnvProxy()
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors shrink-0 flex items-center justify-center min-w-[38px] ${
                    isEnvProxy
                      ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {isEnvProxyLoading ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : isEnvProxy ? (
                    '解绑'
                  ) : (
                    '绑定'
                  )}
                </button>
              </div>
            )}
            <div className="p-1 space-y-0.5">
              {copyOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleCopy(opt.value, opt.label)}
                  className="w-full text-left p-1.5 rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors group"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      {opt.icon || (
                        <Copy className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                      )}
                      <span>{opt.label}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
