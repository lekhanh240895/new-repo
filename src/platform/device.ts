/** Small browser services: Wake Lock, vibration, page visibility (SPEC §12 F7, F10). */
import type { AlarmLevel } from '../core/fsm/types.ts'

export interface ScreenWakeLock {
  /** Keep the screen on. Resolves false if not supported or refused. */
  request(): Promise<boolean>;
  release(): Promise<void>;
  isActive(): boolean;
}

export function createScreenWakeLock(): ScreenWakeLock {
  let sentinel: WakeLockSentinel | null = null
  return {
    async request() {
      if (!('wakeLock' in navigator)) return false
      if (sentinel !== null && !sentinel.released) return true
      try {
        sentinel = await navigator.wakeLock.request('screen')
        sentinel.addEventListener('release', () => {
          sentinel = null
        })
        return true
      } catch (err) {
        // Usually: page not visible, or battery saver. The UI shows a "keep screen on" tip.
        console.warn('BioMonitor: wake lock refused', err)
        sentinel = null
        return false
      }
    },
    async release() {
      const s = sentinel
      sentinel = null
      try {
        await s?.release()
      } catch {
        // Already released by the system.
      }
    },
    isActive: () => sentinel !== null && !sentinel.released,
  }
}

const VIBRATION: Record<AlarmLevel, number[]> = {
  D1: [150],
  L1: [150],
  D2: [200, 100, 200, 100, 200],
  L2: [200, 100, 200, 100, 200],
  L3: [600, 200, 600, 200, 600],
}

export type VibrationKind = AlarmLevel | 'advisory' | 'stop'

/** Vibrate for an alarm level. No-op where unsupported (iOS Safari). */
export function vibrateFor(level: VibrationKind): void {
  if (typeof navigator.vibrate !== 'function') return
  try {
    if (level === 'stop') navigator.vibrate(0)
    else navigator.vibrate(level === 'advisory' ? [100] : VIBRATION[level])
  } catch {
    // Some browsers throw without a recent user gesture; vibration is optional.
  }
}

/** Calls `onChange(hidden)` when the page is hidden or shown. Returns an unsubscribe function. */
export function watchVisibility(onChange: (hidden: boolean) => void): () => void {
  const handler = () => onChange(document.visibilityState === 'hidden')
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
