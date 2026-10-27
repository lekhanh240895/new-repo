/**
 * Common driver looks and speeds for scenarios. Angles are relative to the
 * calibrated road-ahead pose (see types.ts for sign conventions).
 *
 * ASSUMPTIONS (confirm with real clips in P7): eyelid drop when looking down,
 * blendshape values for squint / laugh, and mirror angles in a typical
 * left-hand-drive car.
 */
import type { Context, Look, Segment } from './types.ts'

export const SPEED = { stop: 0, crawl: 4, slow: 15, town: 25, city: 35, road: 60, fast: 80 } as const

export const ROAD: Look = {}
export const LOST: Look = { face: false }
export const CLOSED: Look = { ear: 0.05, blink: 0.95 }

export const LEFT_CHECK: Look = { yaw: -50 }
export const RIGHT_CHECK: Look = { yaw: 55 }
export const MIRROR_L: Look = { yaw: -40, gazeX: -0.3 }
/** The right mirror is far in a left-hand-drive car. */
export const MIRROR_R: Look = { yaw: 60, gazeX: 0.4 }
export const REARVIEW: Look = { yaw: 32, pitch: 15, gazeY: 0.3 }
/** Speedometer: eyes down, lids lower (assumption: EAR −45%, blink score 0.35). */
export const CLUSTER: Look = { pitch: -10, gazeY: -0.7, ear: 0.17, blink: 0.35, future: { eyeLookDown: 0.6 } }
/** Deeper speedometer glance (assumption: EAR −65%, blink score 0.55 — can look "closed"). */
export const CLUSTER_DEEP: Look = { pitch: -15, gazeY: -0.8, ear: 0.1, blink: 0.55, future: { eyeLookDown: 0.85 } }
export const CONSOLE: Look = { yaw: 20, pitch: -25, gazeY: -0.5 }
/** Phone in the lap: head down, eyes down, lids lower. */
export const LAP: Look = { pitch: -25, gazeY: -0.8, ear: 0.14, blink: 0.4, future: { eyeLookDown: 0.8 } }
/** Phone in the lap with the head almost straight: lids so low it can look "closed". */
export const LAP_LOW_LIDS: Look = { pitch: -15, gazeY: -0.85, ear: 0.1, blink: 0.55, future: { eyeLookDown: 0.9 } }
/** The BioMonitor phone itself, on a center vent. */
export const PHONE_MOUNT: Look = { yaw: 25, pitch: -15 }
/** Passenger seat is on the right. */
export const PASSENGER: Look = { yaw: 40 }

export function seg(ms: number, look?: Look, ctx?: Context, mark?: string): Segment {
  return { ms, ...(look && { look }), ...(ctx && { ctx }), ...(mark !== undefined && { mark }) }
}

export function road(ms: number, ctx?: Context, mark?: string): Segment {
  return seg(ms, ROAD, ctx, mark)
}

/** Same segments `n` times. */
export function repeat(n: number, segments: readonly Segment[]): Segment[] {
  return Array.from({ length: n }, () => segments).flat()
}

/** Copy a look with changes. */
export function like(base: Look, changes: Look): Look {
  return { ...base, ...changes, future: { ...base.future, ...changes.future } }
}

/** A smooth change from one look to another over `ms`, in `steps` segments. */
export function ramp(ms: number, from: Look, to: Look, steps = 4, ctx?: Context): Segment[] {
  const keys = ['yaw', 'pitch', 'gazeX', 'gazeY', 'ear', 'blink'] as const
  return Array.from({ length: steps }, (_, i) => {
    const k = (i + 1) / steps
    const look: Look = { ...to }
    for (const key of keys) {
      const a = from[key] ?? (key === 'ear' ? 0.3 : key === 'blink' ? 0.05 : 0)
      const b = to[key] ?? (key === 'ear' ? 0.3 : key === 'blink' ? 0.05 : 0)
      look[key] = a + (b - a) * k
    }
    return seg(ms / steps, look, ctx)
  })
}
