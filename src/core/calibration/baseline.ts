/**
 * Per-driver calibration (SPEC §9): learn this driver's normal eye
 * openness, mouth, head pose and position from a few seconds of frames.
 */
import type { CalibrationConfig } from '../config.ts'
import { clamp, median, quantile } from '../stats.ts'
import type { ProcessedFrame } from '../types.ts'

export interface Baseline {
  earOpen: number;
  earClosed: number;
  /** MAR with the mouth at rest. */
  mar: number;
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
  gazeY: number;
  /** Typical frame-to-frame jitter while still; feeds the shake gate. */
  jitter: number;
  faceCenter: { x: number; y: number };
  faceArea: number;
  /** True when fallback values were used (fewer blinks seen, or no calibration at all). */
  approximate: boolean;
}

/** Used only when calibration could not see the driver at all. */
export const DEFAULT_BASELINE: Readonly<Baseline> = Object.freeze({
  earOpen: 0.28,
  earClosed: 0.1,
  mar: 0.05,
  pitchDeg: 0,
  yawDeg: 0,
  rollDeg: 0,
  gazeY: 0,
  jitter: 0.01,
  faceCenter: { x: 0.5, y: 0.5 },
  faceArea: 0.1,
  approximate: true,
})

export type CalibrationFailure = 'too-few-valid' | 'moving' | 'no-blinks'

export type CalibrationResult =
  | { ok: true; baseline: Baseline; blinks: number }
  | {
      ok: false;
      reason: CalibrationFailure;
      /** Best-effort baseline from what was seen, if enough frames were valid. */
      partial: Baseline | null;
    }

/** A frame counts as "blinking" when the blendshape says so or EAR dips well below open. */
const BLINK_SCORE = 0.5
const BLINK_EAR_RATIO = 0.6
/** Ignore pose outliers (a single glance) when judging "moving". */
const POSE_SPREAD_LO = 0.1
const POSE_SPREAD_HI = 0.9
/** Need at least this many valid frames to estimate anything. */
const MIN_FRAMES_FOR_PARTIAL = 10
const MIN_JITTER = 0.005

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}

type ValidFrame = ProcessedFrame & {
  raw: Required<Pick<ProcessedFrame['raw'], 'eye' | 'pose'>> & ProcessedFrame['raw'];
  smooth: Required<Pick<ProcessedFrame['smooth'], 'pose'>> & ProcessedFrame['smooth'];
}

function isValid(f: ProcessedFrame): f is ValidFrame {
  return f.frameValid && f.raw.faceFound && f.raw.eye !== undefined && f.raw.pose !== undefined && f.smooth.pose !== undefined
}

const meanEar = (f: ValidFrame) => (f.raw.eye.earL + f.raw.eye.earR) / 2
const meanBlink = (f: ValidFrame) => (f.raw.eye.blinkL + f.raw.eye.blinkR) / 2

/** Blink episodes: runs of blinking frames. Returns the lowest EAR of each run. */
function blinkMinima(frames: readonly ValidFrame[], earOpen: number): number[] {
  const minima: number[] = []
  let current: number | null = null
  for (const f of frames) {
    const ear = meanEar(f)
    const blinking = meanBlink(f) >= BLINK_SCORE || ear < earOpen * BLINK_EAR_RATIO
    if (blinking) current = current === null ? ear : Math.min(current, ear)
    else if (current !== null) {
      minima.push(current)
      current = null
    }
  }
  if (current !== null) minima.push(current)
  return minima
}

function spread(values: readonly number[]): number {
  return quantile(values, POSE_SPREAD_HI) - quantile(values, POSE_SPREAD_LO)
}

/** Learn a baseline from calibration frames (raw EAR for blinks, smoothed pose). */
export function computeBaseline(frames: readonly ProcessedFrame[], cfg: CalibrationConfig): CalibrationResult {
  const valid = frames.filter(isValid)
  const validRatio = frames.length === 0 ? 0 : valid.length / frames.length

  let partial: Baseline | null = null
  if (valid.length >= MIN_FRAMES_FOR_PARTIAL) {
    const openFrames = valid.filter((f) => meanBlink(f) < BLINK_SCORE)
    const earOpen = quantile((openFrames.length > 0 ? openFrames : valid).map(meanEar), cfg.openQuantile)
    const minima = blinkMinima(valid, earOpen)
    const fallbackClosed = earOpen * cfg.closedFromOpenRatio
    // A real "closed" EAR must sit clearly below "open"; otherwise use the fallback ratio.
    const measuredClosed = minima.length >= cfg.minBlinks ? median(minima) : Number.NaN
    const earClosed = Number.isFinite(measuredClosed) && measuredClosed < earOpen * 0.8 ? measuredClosed : fallbackClosed
    const centers = valid.map((f) => f.raw.quality.faceCenter).filter((c) => c !== undefined)
    partial = {
      earOpen,
      earClosed: clamp(earClosed, 0, earOpen * 0.8),
      mar: finiteOr(median(valid.map((f) => f.raw.mouth?.mar ?? Number.NaN)), DEFAULT_BASELINE.mar),
      pitchDeg: median(valid.map((f) => f.smooth.pose.pitchDeg)),
      yawDeg: median(valid.map((f) => f.smooth.pose.yawDeg)),
      rollDeg: median(valid.map((f) => f.smooth.pose.rollDeg)),
      gazeY: finiteOr(median(valid.map((f) => f.smooth.gaze?.y ?? Number.NaN)), 0),
      // Floor: a very still calibration would make normal head motion look like shaking.
      jitter: Math.max(MIN_JITTER, finiteOr(median(valid.map((f) => f.raw.quality.landmarkJitter)), 0)),
      faceCenter:
        centers.length > 0
          ? { x: median(centers.map((c) => c.x)), y: median(centers.map((c) => c.y)) }
          : { ...DEFAULT_BASELINE.faceCenter },
      faceArea: median(valid.map((f) => f.raw.quality.faceAreaRatio)),
      approximate: !(minima.length >= cfg.minBlinks),
    }
  }

  if (partial === null || validRatio < cfg.minValidRatio) {
    return { ok: false, reason: 'too-few-valid', partial }
  }
  const pitches = valid.map((f) => f.smooth.pose.pitchDeg)
  const yaws = valid.map((f) => f.smooth.pose.yawDeg)
  if (spread(pitches) > cfg.maxPoseSpreadDeg || spread(yaws) > cfg.maxPoseSpreadDeg) {
    return { ok: false, reason: 'moving', partial }
  }
  const blinks = blinkMinima(valid, partial.earOpen).length
  if (blinks < cfg.minBlinks) {
    return { ok: false, reason: 'no-blinks', partial }
  }
  return { ok: true, baseline: partial, blinks }
}

/**
 * After the last failed attempt: continue with what was learned, marked
 * approximate, or with population defaults if nothing usable was seen (SPEC §9).
 */
export function fallbackBaseline(result: CalibrationResult): Baseline {
  if (result.ok) return result.baseline
  return result.partial === null ? { ...DEFAULT_BASELINE } : { ...result.partial, approximate: true }
}
