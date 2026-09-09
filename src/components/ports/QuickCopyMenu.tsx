import { ChevronDown, Copy, Terminal } from 'lucide-react'
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
}

export const QuickCopyMenu: React.FC<QuickCopyMenuProps> = ({
  port,
  protocol,
  hostIp,
  bypassDomains,
  disabled = false,
  onCopySuccess,
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
    const menuHeight = 220
    const shouldPlaceTop = spaceBelow < menuHeight && rect.top > menuHeight

    const top = shouldPlaceTop ? rect.top - menuHeight - 4 : rect.bottom + 4
    const left = Math.max(
      8,
      Math.min(rect.right - 224, window.innerWidth - 232),
    )

    setMenuPos({
      top,
      left,
      placement: shouldPlaceTop ? 'top' : 'bottom',
    })
  }, [])
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
            : 'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer'
        }`}
        title={disabled ? '端口已禁用，无法复制代理配置' : '快捷复制代理格式'}
      >
        <Copy className="w-3 h-3" />
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
              width: '224px',
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
