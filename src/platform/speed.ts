/**
 * Optional speed arming (SPEC §10.6): with location permission, alarms only
 * fire when moving. Unknown speed always counts as "moving" (fail-safe).
 */

export interface SpeedMonitor {
  /** km/h, or null when unknown. */
  speedKmh(): number | null;
  /** True when moving or unknown. */
  armed(): boolean;
  stop(): void;
}

/** Fixes older than this are treated as unknown. */
const STALE_MS = 10_000

/** Pure rule, shared with tests. */
export function isArmed(speedKmh: number | null, armAboveKmh: number): boolean {
  return speedKmh === null || speedKmh > armAboveKmh
}

export function startSpeedMonitor(armAboveKmh: number, now: () => number = () => performance.now()): SpeedMonitor {
  let speed: number | null = null
  let at = -Infinity
  let watchId: number | null = null

  if ('geolocation' in navigator) {
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const s = pos.coords.speed
          speed = s === null || !Number.isFinite(s) ? null : Math.max(0, s * 3.6)
          at = now()
        },
        (err) => {
          console.warn('BioMonitor: location unavailable, alarms stay armed', err.message)
          speed = null
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15_000 },
      )
    } catch (err) {
      console.warn('BioMonitor: location unavailable, alarms stay armed', err)
    }
  }

  const current = () => (now() - at > STALE_MS ? null : speed)
  return {
    speedKmh: current,
    armed: () => isArmed(current(), armAboveKmh),
    stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      watchId = null
    },
  }
}
