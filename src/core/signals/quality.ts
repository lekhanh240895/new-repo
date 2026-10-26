/**
 * Quality gates (SPEC §8.6): decide whether the camera can see the driver
 * well enough to trust this frame.
 *
 * Not in M1: EYES_HIDDEN (sunglasses) detection. It needs real recordings to
 * find a reliable signal and comes in M2.
 */
import type { QualityConfig } from '../config.ts'
import type { FrameResult, SensorState } from '../types.ts'

export interface QualityOutput {
  sensor: SensorState;
  /** False when this frame should not feed detectors (blind, shaking). */
  frameValid: boolean;
  /** Frames per second over the last `minFpsWindowMs`. */
  fps: number;
}

export interface QualityTracker {
  update(frame: FrameResult): QualityOutput;
  /** Jitter measured during calibration. Until set, the shake gate is off. */
  setBaselineJitter(value: number | null): void;
  reset(): void;
}

export function createQualityTracker(cfg: QualityConfig): QualityTracker {
  let lostSince: number | null = null
  let badLightSince: number | null = null
  let shakeSince: number | null = null
  let lowFpsSince: number | null = null
  let recent: number[] = []
  let baselineJitter: number | null = null

  function fpsAt(t: number): number {
    recent = recent.filter((x) => x > t - cfg.minFpsWindowMs)
    recent.push(t)
    const first = recent[0]
    if (first === undefined || recent.length < 2 || t === first) return 0
    return ((recent.length - 1) * 1000) / (t - first)
  }

  return {
    update(frame) {
      const { t } = frame
      const fps = fpsAt(t)
      // Only judge fps once the window is full, so start-up does not look "slow".
      const windowFull = (recent[0] ?? t) <= t - cfg.minFpsWindowMs * 0.9
      lowFpsSince = windowFull && fps < cfg.minFps ? (lowFpsSince ?? t) : null

      if (!frame.faceFound) {
        lostSince = lostSince ?? t
        shakeSince = null
        // With no face, faceLuma is the whole frame: tells "too dark" (night, tunnel) from "no driver".
        const dark = frame.quality.faceLuma < cfg.minFaceLuma
        badLightSince = dark ? (badLightSince ?? t) : null
        if (badLightSince !== null && t - badLightSince >= cfg.badLightMs) {
          return { sensor: 'LOW_VISIBILITY', frameValid: false, fps }
        }
        const sensor = t - lostSince >= cfg.occlusionMaxMs ? 'NO_FACE' : 'OCCLUDED'
        return { sensor, frameValid: false, fps }
      }
      lostSince = null

      const q = frame.quality
      const badLight =
        q.faceLuma < cfg.minFaceLuma || q.faceLuma > cfg.maxFaceLuma || q.faceAreaRatio < cfg.minFaceAreaRatio
      badLightSince = badLight ? (badLightSince ?? t) : null
      if (badLightSince !== null && t - badLightSince >= cfg.badLightMs) {
        return { sensor: 'LOW_VISIBILITY', frameValid: false, fps }
      }

      const shaking = baselineJitter !== null && q.landmarkJitter > cfg.jitterFactor * baselineJitter
      shakeSince = shaking ? (shakeSince ?? t) : null
      const frameValid = !(shakeSince !== null && t - shakeSince >= cfg.jitterMs)

      // fps is already averaged over minFpsWindowMs, so "below now" means "below for the window".
      return { sensor: lowFpsSince !== null ? 'DEGRADED' : 'OK', frameValid, fps }
    },
    setBaselineJitter(value) {
      baselineJitter = value !== null && Number.isFinite(value) && value > 0 ? value : null
    },
    reset() {
      lostSince = null
      badLightSince = null
      shakeSince = null
      lowFpsSince = null
      recent = []
    },
  }
}
