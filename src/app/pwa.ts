/**
 * Service worker registration (offline PWA). Updates are never applied
 * automatically: the start screen offers "Update" only when no trip is running.
 */
import { useSyncExternalStore } from 'react'

interface PwaState {
  /** A new version is downloaded and waiting. */
  updateReady: boolean;
  /** The app shell is cached and works offline. */
  offlineReady: boolean;
}

let state: PwaState = { updateReady: false, offlineReady: false }
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/** Call once at start-up. Safe where service workers are unsupported. */
export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    applyUpdate = registerSW({
      onNeedRefresh: () => set({ updateReady: true }),
      onOfflineReady: () => set({ offlineReady: true }),
      onRegisterError: (err: unknown) => console.warn('BioMonitor: service worker failed', err),
    })
  } catch (err) {
    console.warn('BioMonitor: offline mode unavailable', err)
  }
}

/** Reloads the page with the new version. Only call when no trip is running. */
export function installUpdate(): void {
  void applyUpdate?.(true)
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
