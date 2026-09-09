import {
  listen,
  type UnlistenFn,
  type EventCallback,
} from '@tauri-apps/api/event'

export interface EventScope {
  /** Register a Tauri event listener within this scope */
  listen<T>(eventName: string, callback: EventCallback<T>): Promise<UnlistenFn>
  /** Check whether this scope has been disposed */
  isDisposed(): boolean
  /** Dispose all listeners in this scope */
  dispose(): void
}

/**
 * Creates a managed event subscription scope.
 * Guarantees that:
 * 1. Listeners resolving after scope disposal are immediately unlistened (race-condition free).
 * 2. Disposal cleans up all registered unlisteners exactly once.
 * 3. Scope disposal stops pending and subsequent listeners.
 */
export function createEventScope(): EventScope {
  let disposed = false
  const unlisteners = new Set<UnlistenFn>()

  return {
    isDisposed: () => disposed,
    async listen<T>(
      eventName: string,
      callback: EventCallback<T>,
    ): Promise<UnlistenFn> {
      if (disposed) {
        return () => {}
      }

      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        return () => {}
      }

      try {
        const unlisten = await listen<T>(eventName, (event) => {
          if (!disposed) {
            callback(event)
          }
        })

        if (disposed) {
          try {
            unlisten()
          } catch {
            // ignore cleanup errors during race
          }
          return () => {}
        }

        unlisteners.add(unlisten)
        return () => {
          unlisteners.delete(unlisten)
          try {
            unlisten()
          } catch {
            // ignore
          }
        }
      } catch (err) {
        if (!disposed) {
          console.error(`[events] Failed to subscribe to ${eventName}:`, err)
        }
        return () => {}
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      const toClean = Array.from(unlisteners)
      unlisteners.clear()
      for (const unlisten of toClean) {
        try {
          unlisten()
        } catch (err) {
          console.error('[events] Error unlistening event:', err)
        }
      }
    },
  }
}
