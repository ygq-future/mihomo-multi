import type React from 'react'
import { useEffect } from 'react'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'

export const App: React.FC = () => {
  const { fetchStatus } = useAppStore()

  useEffect(() => {
    fetchStatus()

    // Periodically poll status every 3 seconds
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)

    return () => clearInterval(interval)
  }, [fetchStatus])

  return <Shell />
}

export default App
