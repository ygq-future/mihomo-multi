import { useEffect, useState } from 'react'
import { createEventScope } from './events'

/**
 * Tracks native window visibility state by listening to:
 * 1. Native Tauri `window-visibility-change` events (broadcasted by Rust upon hide/show/activate).
 * 2. Web standard `document.visibilitychange` (as fallback / belt-and-suspenders).
 */
export function useWindowVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.visibilityState === 'visible'
    }
    return true
  })

  useEffect(() => {
    const scope = createEventScope()

    scope
      .listen<boolean>('window-visibility-change', (event) => {
        setIsVisible(Boolean(event.payload))
      })
      .catch(() => {})

    const handleDocVisibility = () => {
      setIsVisible(document.visibilityState === 'visible')
    }

    document.addEventListener('visibilitychange', handleDocVisibility)

    return () => {
      scope.dispose()
      document.removeEventListener('visibilitychange', handleDocVisibility)
    }
  }, [])

  return isVisible
}
