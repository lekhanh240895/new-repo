/**
 * Motion sensors (docs/ALERT_ACCURACY_PLAN.md, T2). The phone is mounted in
 * the car, so it feels the car: the gyroscope gives the turn rate, the
 * accelerometer tells "very still" (maybe stopped) from driving vibration.
 *
 * The phone can be mounted in any orientation, so the turn rate is the
 * rotation around "up", where up comes from gravity (a slow average of the
 * accelerometer). Sign: > 0 = turning right. Device-axis signs follow the W3C
 * DeviceMotion spec (right-hand rule); confirm on a real drive in Debug mode.
 */
import type { MotionState } from '../core/detectors/pipeline.ts'

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MotionSample {
  t: number;
  /** accelerationIncludingGravity, m/s² (points "up" at rest). */
  accG: Vec3;
  /** Rotation rate, °/s around the device axes: x = beta, y = gamma, z = alpha. */
  rot: Vec3;
}

/** Turn rate of the car (°/s, > 0 = right) from the gravity direction and the device rotation. */
export function turnRateFrom(gravity: Vec3, rot: Vec3): number | null {
  const n = Math.hypot(gravity.x, gravity.y, gravity.z)
  if (!(n > 1)) return null
  // Rotation around "up" (right-hand rule): positive = counter-clockwise from above = turning left.
  const aroundUp = (rot.x * gravity.x + rot.y * gravity.y + rot.z * gravity.z) / n
  return -aroundUp
}

export interface MotionEstimator {
  add(s: MotionSample): void;
  state(now: number): MotionState;
}

const GRAVITY_ALPHA = 0.05
const TURN_ALPHA = 0.15
const STILL_WINDOW_MS = 3000
/** Below this vibration (m/s², standard deviation) and turn rate, the phone is "very still". */
const STILL_ACCEL_STD = 0.15
const STILL_TURN = 2
/** No sample for this long: no sensor. */
const STALE_MS = 2000

/** Pure estimator: feed samples, read the state. */
export function createMotionEstimator(): MotionEstimator {
  let gravity: Vec3 | null = null
  let turn = 0
  let lastT = -Infinity
  let firstT: number | null = null
  let recent: { t: number; lin: number; turn: number }[] = []

  return {
    add(s) {
      if (![s.accG.x, s.accG.y, s.accG.z, s.rot.x, s.rot.y, s.rot.z].every(Number.isFinite)) return
      gravity = gravity === null
        ? { ...s.accG }
        : {
            x: gravity.x + GRAVITY_ALPHA * (s.accG.x - gravity.x),
            y: gravity.y + GRAVITY_ALPHA * (s.accG.y - gravity.y),
            z: gravity.z + GRAVITY_ALPHA * (s.accG.z - gravity.z),
          }
      const r = turnRateFrom(gravity, s.rot)
      if (r !== null) turn += TURN_ALPHA * (r - turn)
      const lin = Math.hypot(s.accG.x - gravity.x, s.accG.y - gravity.y, s.accG.z - gravity.z)
      firstT ??= s.t
      lastT = s.t
      recent.push({ t: s.t, lin, turn: Math.abs(turn) })
      recent = recent.filter((e) => e.t > s.t - STILL_WINDOW_MS)
    },
    state(now) {
      if (now - lastT > STALE_MS || gravity === null) return { turnRate: null, still: false }
      const full = firstT !== null && lastT - firstT >= STILL_WINDOW_MS
      const mean = recent.reduce((a, e) => a + e.lin, 0) / Math.max(1, recent.length)
      const std = Math.sqrt(recent.reduce((a, e) => a + (e.lin - mean) ** 2, 0) / Math.max(1, recent.length))
      const still = full && std < STILL_ACCEL_STD && recent.every((e) => e.turn < STILL_TURN)
      return { turnRate: turn, still }
    },
  }
}

/** iOS asks for permission; call this inside the Start tap. Elsewhere it resolves true. */
export async function requestMotionPermission(): Promise<boolean> {
  const Dme = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent
  if (Dme === undefined) return false
  if (typeof Dme.requestPermission !== 'function') return true
  try {
    return (await Dme.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export interface MotionMonitor {
  state(): MotionState;
  stop(): void;
}

/** Listens to devicemotion. Without a sensor (or permission) the state stays "no sensor". */
export function startMotionMonitor(now: () => number = () => performance.now()): MotionMonitor {
  const estimator = createMotionEstimator()
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity
    const r = e.rotationRate
    if (!a || !r) return
    estimator.add({
      t: now(),
      accG: { x: a.x ?? Number.NaN, y: a.y ?? Number.NaN, z: a.z ?? Number.NaN },
      rot: { x: r.beta ?? Number.NaN, y: r.gamma ?? Number.NaN, z: r.alpha ?? Number.NaN },
    })
  }
  if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) window.addEventListener('devicemotion', onMotion)
  return {
    state: () => estimator.state(now()),
    stop: () => window.removeEventListener('devicemotion', onMotion),
  }
}
