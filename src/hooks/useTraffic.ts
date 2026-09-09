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
 * @param enabled 是否开启订阅 (例如当窗口在后台隐藏时置为 false，彻底关闭连接节省后台资源)
 */
export function useTraffic(
  running: boolean,
  port?: number,
  secret?: string,
  enabled: boolean = true,
): TrafficData {
  const [traffic, setTraffic] = useState<TrafficData>({ up: 0, down: 0 })
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    // 内核未运行、无端口或窗口处于隐藏状态时，关闭已有连接并停止重连
    if (!running || !port || !enabled) {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      setTraffic((prev) =>
        prev.up === 0 && prev.down === 0 ? prev : { up: 0, down: 0 },
      )
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
            const up = typeof data.up === 'number' ? data.up : 0
            const down = typeof data.down === 'number' ? data.down : 0
            setTraffic((prev) =>
              prev.up === up && prev.down === down ? prev : { up, down },
            )
          } catch {
            // 忽略非标准消息
          }
        }

        ws.onerror = () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close()
          }
        }

        ws.onclose = () => {
          wsRef.current = null
          if (!isDisposed) {
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
      setTraffic((prev) =>
        prev.up === 0 && prev.down === 0 ? prev : { up: 0, down: 0 },
      )
    }
  }, [running, port, secret, enabled])

  return traffic
}
