/**
 * Keeps the driver's personal adaptation (T12) on this device. Only two small
 * counters are stored: no video, no times, no places. Storage can be blocked
 * (private mode, cleared site data): then the app simply uses the defaults.
 */
import { DEFAULT_PERSONAL, parsePersonal, type Personal } from '../core/personal.ts'

const KEY = 'biomonitor.personal.v1'

export function loadPersonal(): Personal {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? { ...DEFAULT_PERSONAL } : parsePersonal(JSON.parse(raw))
  } catch (err) {
    console.warn('BioMonitor: personal settings unavailable, using defaults', err)
    return { ...DEFAULT_PERSONAL }
  }
}

/** Returns false when the device would not store it. */
export function savePersonal(p: Personal): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(parsePersonal(p)))
    return true
  } catch (err) {
    console.warn('BioMonitor: could not save personal settings', err)
    return false
  }
}

export function resetPersonal(): boolean {
  try {
    localStorage.removeItem(KEY)
    return true
  } catch (err) {
    console.warn('BioMonitor: could not reset personal settings', err)
    return false
  }
}
