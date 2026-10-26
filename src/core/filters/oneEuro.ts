/**
 * One Euro filter (Casiez et al., CHI 2012). Smooths jitter when a signal is
 * still, and follows it with little lag when it moves fast (SPEC §8.5).
 */

export interface OneEuroParams {
  /** Hz. Lower = smoother when still. */
  minCutoff: number;
  /** How fast the cutoff rises with speed. Higher = less lag on fast moves. */
  beta: number;
  /** Hz, for the speed estimate. */
  dCutoff: number;
}

export interface OneEuroFilter {
  /** `tMs` must increase. Returns the smoothed value. */
  filter(value: number, tMs: number): number;
  reset(): void;
}

export const DEFAULT_ONE_EURO: Readonly<OneEuroParams> = Object.freeze({
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
})

function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dtSec)
}

export function createOneEuroFilter(params: OneEuroParams = DEFAULT_ONE_EURO): OneEuroFilter {
  if (!(params.minCutoff > 0) || !(params.dCutoff > 0) || !(params.beta >= 0)) {
    throw new RangeError(`invalid One Euro params: ${JSON.stringify(params)}`)
  }
  let lastT: number | null = null
  let lastX = 0
  let lastDx = 0

  return {
    filter(value, tMs) {
      // Bad input never corrupts the filter: return the last good output.
      if (!Number.isFinite(value) || !Number.isFinite(tMs)) return lastT === null ? value : lastX
      if (lastT === null) {
        lastT = tMs
        lastX = value
        lastDx = 0
        return value
      }
      if (tMs <= lastT) return lastX
      const dt = (tMs - lastT) / 1000
      const dx = (value - lastX) / dt
      const dxHat = lastDx + alpha(params.dCutoff, dt) * (dx - lastDx)
      const cutoff = params.minCutoff + params.beta * Math.abs(dxHat)
      const xHat = lastX + alpha(cutoff, dt) * (value - lastX)
      lastT = tMs
      lastX = xHat
      lastDx = dxHat
      return xHat
    },
    reset() {
      lastT = null
      lastX = 0
      lastDx = 0
    },
  }
}
