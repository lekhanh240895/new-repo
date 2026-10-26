/** Battery level (SPEC §12 F18). Chromium only; elsewhere this does nothing. */

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

/** Calls `onChange` now and on every change. Returns an unsubscribe function. */
export function watchBattery(onChange: (state: { level: number; charging: boolean }) => void): () => void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }
  if (typeof nav.getBattery !== 'function') return () => {}
  let battery: BatteryManagerLike | null = null
  let stopped = false
  const emit = () => {
    if (battery !== null) onChange({ level: battery.level, charging: battery.charging })
  }
  nav
    .getBattery()
    .then((b) => {
      if (stopped) return
      battery = b
      b.addEventListener('levelchange', emit)
      b.addEventListener('chargingchange', emit)
      emit()
    })
    .catch((err: unknown) => console.warn('BioMonitor: battery status unavailable', err))
  return () => {
    stopped = true
    battery?.removeEventListener('levelchange', emit)
    battery?.removeEventListener('chargingchange', emit)
  }
}
