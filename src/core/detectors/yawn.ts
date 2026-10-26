/**
 * Yawn detection (SPEC §10.2, §12 F11): mouth wide open, held ≥ 1.2 s, and
 * not part of fast open/close cycles (talking, singing).
 */
import type { FatigueConfig, MouthConfig } from '../config.ts'

export interface YawnDetector {
  /** `openness` 0–1, or null when the mouth cannot be judged. Returns true once per yawn. */
  update(t: number, openness: number | null): boolean;
}

const SPEECH_LOOKBACK_MS = 2000

export function createYawnDetector(fatigue: FatigueConfig, mouth: MouthConfig): YawnDetector {
  let history: { t: number; v: number }[] = []
  let openSince: number | null = null
  let counted = false

  /** Upward crossings of the speech level in [from, to): one per open/close cycle. */
  function cyclesBetween(from: number, to: number): number {
    let cycles = 0
    let prev: number | null = null
    for (const h of history) {
      if (h.t < from || h.t >= to) continue
      if (prev !== null && prev < mouth.speechCrossLevel && h.v >= mouth.speechCrossLevel) cycles++
      prev = h.v
    }
    return cycles
  }

  return {
    update(t, openness) {
      history = history.filter((h) => h.t > t - SPEECH_LOOKBACK_MS - fatigue.yawnMinMs - 1000)
      if (openness === null) {
        openSince = null
        counted = false
        return false
      }
      history.push({ t, v: openness })
      if (openness <= fatigue.yawnOpenAbove) {
        openSince = null
        counted = false
        return false
      }
      openSince ??= t
      if (counted || t - openSince < fatigue.yawnMinMs) return false
      counted = true
      const cyclesPerSec = cyclesBetween(openSince - SPEECH_LOOKBACK_MS, openSince) / (SPEECH_LOOKBACK_MS / 1000)
      return cyclesPerSec < fatigue.speechCyclesPerSec
    },
  }
}
