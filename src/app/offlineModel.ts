/**
 * Offline readiness of the face model, as a small store for the start screen.
 * On Wi-Fi the model downloads by itself; on mobile data (or when the browser
 * cannot tell) the start screen offers a button with the size.
 */
import { useSyncExternalStore } from 'react'
import {
  autoDownloadAllowed,
  currentConnection,
  downloadFiles,
  filesCached,
  offlineSupported,
  persistStorage,
  removeOldModelCaches,
} from '../platform/offline.ts'
import { modelFiles } from '../vision/engine.ts'

export type OfflineModelState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'needsDownload' }
  | { kind: 'downloading'; mb: number }
  | { kind: 'failed' }
  /** No service worker or cache storage (dev mode, some private windows). */
  | { kind: 'unsupported' }

/** How long to wait for the service worker before saying "cannot work offline". */
const SHELL_TIMEOUT_MS = 15_000

let state: OfflineModelState = { kind: 'checking' }
let files: string[] | null = null
let started = false
const listeners = new Set<() => void>()

function set(next: OfflineModelState) {
  state = next
  for (const l of listeners) l()
}

async function onReady() {
  set({ kind: 'ready' })
  // Best effort: keep the model when space runs low, and free the old versions.
  await persistStorage()
  await removeOldModelCaches().catch(() => {})
}

/** Checks the cache and, on Wi-Fi, downloads what is missing. Runs once per app load. */
export async function startOfflineModel(): Promise<void> {
  if (started) return
  started = true
  if (!offlineSupported()) {
    set({ kind: 'unsupported' })
    return
  }
  try {
    // "Works offline" needs the app shell too: wait for the service worker (it may never come, e.g. blocked).
    const shell = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHELL_TIMEOUT_MS)),
    ])
    if (!shell) {
      set({ kind: 'unsupported' })
      return
    }
    files = await modelFiles()
    if (await filesCached(files)) {
      await onReady()
      return
    }
  } catch (err) {
    console.warn('BioMonitor: cannot check the offline model', err)
    set({ kind: 'unsupported' })
    return
  }
  if (autoDownloadAllowed(currentConnection())) await downloadModel()
  else set({ kind: 'needsDownload' })
}

/** Downloads the model now (the button on mobile data, or a retry). */
export async function downloadModel(): Promise<void> {
  if (files === null || state.kind === 'downloading') return
  set({ kind: 'downloading', mb: 0 })
  try {
    await downloadFiles(files, (bytes) => {
      const mb = Math.floor(bytes / 1e6)
      if (state.kind !== 'downloading' || state.mb !== mb) set({ kind: 'downloading', mb })
    })
    await onReady()
  } catch (err) {
    console.warn('BioMonitor: offline download failed', err)
    set({ kind: 'failed' })
  }
}

export function useOfflineModel(): OfflineModelState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
