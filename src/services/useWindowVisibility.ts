import { useEffect, useState } from 'react'
import { createEventScope } from './events'

let currentVisible =
  typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
const listeners = new Set<(visible: boolean) => void>()
let teardownSingleton: (() => void) | null = null

function notifyVisibility(next: boolean) {
  if (currentVisible === next) return
  currentVisible = next
  for (const fn of listeners) {
    fn(next)
  }
}

function ensureSingletonListener() {
  if (teardownSingleton) return
  const scope = createEventScope()
  scope
    .listen<boolean>('window-visibility-change', (event) => {
      notifyVisibility(Boolean(event.payload))
    })
    .catch(() => {})

  const handleDocVisibility = () => {
    notifyVisibility(document.visibilityState === 'visible')
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleDocVisibility)
  }

  teardownSingleton = () => {
    scope.dispose()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleDocVisibility)
    }
    teardownSingleton = null
  }
}

/**
 * Tracks native window visibility state via a single shared Tauri + DOM listener.
 */
export function useWindowVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => currentVisible)

  useEffect(() => {
    listeners.add(setIsVisible)
    ensureSingletonListener()
    setIsVisible(currentVisible)

    return () => {
      listeners.delete(setIsVisible)
      if (listeners.size === 0 && teardownSingleton) {
        teardownSingleton()
      }
    }
  }, [])

  return isVisible
}
