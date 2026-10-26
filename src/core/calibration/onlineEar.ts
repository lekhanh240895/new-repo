/**
 * Slowly follows the driver's open-eye EAR during the trip (SPEC §9), for
 * example as light or camera angle changes. Bounded drift stops it from
 * learning drowsy, half-closed eyes as "normal".
 */
import type { CalibrationConfig } from '../config.ts'
import { clamp, quantile } from '../stats.ts'
import type { Baseline } from './baseline.ts'

export interface EarRange {
  earOpen: number;
  earClosed: number;
}

export interface OnlineEarTracker {
  /** `eligible`: eyes open, no alarm, low PERCLOS. Ineligible samples are ignored. */
  update(t: number, ear: number, eligible: boolean): void;
  current(): EarRange;
}

const SAMPLE_EVERY_MS = 500
/** Need about a minute of open-eye samples before moving away from calibration. */
const MIN_SAMPLES = 120

export function createOnlineEarTracker(base: Baseline, cfg: CalibrationConfig): OnlineEarTracker {
  const capacity = Math.max(MIN_SAMPLES, Math.round(cfg.onlineWindowMs / SAMPLE_EVERY_MS))
  const closedRatio = base.earOpen > 0 ? base.earClosed / base.earOpen : 0.35
  const lo = base.earOpen * (1 - cfg.maxDriftRatio)
  const hi = base.earOpen * (1 + cfg.maxDriftRatio)
  const samples: number[] = []
  let lastSampleT = -Infinity
  let range: EarRange = { earOpen: base.earOpen, earClosed: base.earClosed }

  return {
    update(t, ear, eligible) {
      if (!eligible || !Number.isFinite(ear) || t - lastSampleT < SAMPLE_EVERY_MS) return
      lastSampleT = t
      samples.push(ear)
      if (samples.length > capacity) samples.shift()
      if (samples.length < MIN_SAMPLES) return
      const earOpen = clamp(quantile(samples, cfg.openQuantile), lo, hi)
      range = { earOpen, earClosed: earOpen * closedRatio }
    },
    current: () => range,
  }
}
