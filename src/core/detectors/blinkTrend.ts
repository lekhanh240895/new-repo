/**
 * Blinks getting longer during a trip (E10). Alert drivers blink in about
 * 100–200 ms; blinks grow longer as fatigue builds, well before microsleeps.
 * The driver's own normal is learned in the first minutes of the trip, then
 * the recent mean is compared with it.
 */
import type { BlinkTrendConfig } from '../config.ts'

export interface BlinkTrend {
  /** A blink ended at `t` after `ms` of closure. */
  add(t: number, ms: number): void;
  /** True when recent blinks are much longer than this driver's normal. */
  tired(t: number): boolean;
  /** Learned normal blink length (ms), or null while still learning. */
  normalMs(): number | null;
}

export function createBlinkTrend(cfg: BlinkTrendConfig): BlinkTrend {
  let startT: number | null = null
  const early: number[] = []
  let recent: { t: number; ms: number }[] = []

  return {
    add(t, ms) {
      if (!Number.isFinite(ms) || ms <= 0) return
      startT ??= t
      if (t - startT <= cfg.baselineMs) early.push(ms)
      recent.push({ t, ms })
    },
    tired(t) {
      const normal = this.normalMs()
      if (normal === null || startT === null || t - startT <= cfg.baselineMs) return false
      recent = recent.filter((b) => b.t > t - cfg.recentMs)
      if (recent.length < cfg.minRecentBlinks) return false
      const mean = recent.reduce((a, b) => a + b.ms, 0) / recent.length
      return mean >= cfg.minMs && mean >= cfg.ratio * normal
    },
    normalMs() {
      if (early.length < cfg.minBaselineBlinks) return null
      // Median: one slow blink in the first minutes does not move it.
      const sorted = [...early].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)] ?? null
    },
  }
}
