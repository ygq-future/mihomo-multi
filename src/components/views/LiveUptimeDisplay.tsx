import type React from 'react'
import { useEffect, useState } from 'react'
import { formatUptime } from '../../utils/time'

interface LiveUptimeDisplayProps {
  isRunning: boolean
  uptimeSeconds?: number
}

/**
 * Dedicated isolated component for live 1-second uptime ticking.
 * Isolating this prevents re-rendering the entire 2000-line SettingView every second.
 */
export const LiveUptimeDisplay: React.FC<LiveUptimeDisplayProps> = ({
  isRunning,
  uptimeSeconds = 0,
}) => {
  const [liveUptime, setLiveUptime] = useState<number>(uptimeSeconds)

  useEffect(() => {
    setLiveUptime(uptimeSeconds)
  }, [uptimeSeconds])

  useEffect(() => {
    if (!isRunning) {
      setLiveUptime(0)
      return
    }

    const timer = setInterval(() => {
      setLiveUptime((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [isRunning])

  return (
    <div className="font-mono font-medium text-foreground">
      {isRunning ? formatUptime(liveUptime) : '0s'}
    </div>
  )
}
