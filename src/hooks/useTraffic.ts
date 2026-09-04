import { useEffect, useRef, useState } from 'react'

export interface TrafficData {
  up: number
  down: number
}

/**
 * 订阅 Mihomo 内核的 /traffic 实时流量 WebSocket
 * @param running 内核是否运行中
 * @param port 控制器端口 (如 9999)
 * @param secret 控制器密钥
 */
export function useTraffic(
  running: boolean,
  port?: number,
  secret?: string,
): TrafficData {
  const [traffic, setTraffic] = useState<TrafficData>({ up: 0, down: 0 })
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    // 内核未运行或无端口时清零并关闭已有连接
    if (!running || !port) {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      setTraffic({ up: 0, down: 0 })
      return
    }

    let isDisposed = false

    const connect = () => {
      if (isDisposed) return

      try {
        const tokenParam = secret ? `?token=${encodeURIComponent(secret)}` : ''
        const url = `ws://127.0.0.1:${port}/traffic${tokenParam}`
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onmessage = (event) => {
          if (isDisposed) return
          try {
            const data = JSON.parse(event.data)
            setTraffic({
              up: typeof data.up === 'number' ? data.up : 0,
              down: typeof data.down === 'number' ? data.down : 0,
            })
          } catch {
            // 忽略非标准消息
          }
        }

        ws.onerror = () => {
          // 遇到异常关闭连接，由 onclose 触发重连
          if (ws.readyState === WebSocket.OPEN) {
            ws.close()
          }
        }

        ws.onclose = () => {
          wsRef.current = null
          if (!isDisposed) {
            // 内核仍在运行中时，2 秒后尝试重连
            reconnectTimeoutRef.current = window.setTimeout(connect, 2000)
          }
        }
      } catch {
        if (!isDisposed) {
          reconnectTimeoutRef.current = window.setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      isDisposed = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setTraffic({ up: 0, down: 0 })
    }
  }, [running, port, secret])

  return traffic
}
