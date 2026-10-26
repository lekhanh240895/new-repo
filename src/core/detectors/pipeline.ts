/**
 * Turns smoothed, quality-checked frames into the per-frame inputs of the
 * state machine (FrameSignals), relative to the driver's baseline (SPEC §8–§10).
 */
import { createOnlineEarTracker, type EarRange } from '../calibration/onlineEar.ts'
import type { Baseline } from '../calibration/baseline.ts'
import type { Config } from '../config.ts'
import { clamp } from '../stats.ts'
import type { FatigueLevel, FrameSignals, ProcessedFrame } from '../types.ts'
import { createNodDetector } from './nod.ts'
import { createEventCounter, createPerclos } from './windows.ts'
import { createYawnDetector } from './yawn.ts'

/** Extra numbers for Debug mode and trip logs. */
export interface SignalDebug {
  /** Fused eye openness, 0 = closed, 1 = calibrated open. */
  openness: number | null;
  mouth: number | null;
  /** Head below baseline in degrees (positive = down). */
  downDeg: number | null;
  /** Head turn from baseline in degrees. */
  yawDeg: number | null;
  perclos: number | null;
  slowBlinks: number;
  yawns: number;
  nods: number;
  ear: EarRange;
  /** The phone mount seems to have moved: ask to re-calibrate (SPEC §12 F16). */
  needsRecalibration: boolean;
}

export interface PipelineContext {
  /** Car moving (or speed unknown). */
  armed: boolean;
  /** An alarm is active: do not adapt the baseline now. */
  alarmActive: boolean;
}

export interface SignalPipeline {
  update(frame: ProcessedFrame, ctx: PipelineContext): { signals: FrameSignals; debug: SignalDebug };
}

/** Fused openness of one eye: normalized EAR mixed with the blendshape (SPEC §8.1). */
export function eyeOpenness(ear: number, blink: number, range: EarRange, earWeight: number): number {
  const span = range.earOpen - range.earClosed
  const norm = span > 0 ? clamp((ear - range.earClosed) / span, 0, 1) : 0
  return earWeight * norm + (1 - earWeight) * (1 - clamp(blink, 0, 1))
}

export function createSignalPipeline(cfg: Config, baseline: Baseline): SignalPipeline {
  const ear = createOnlineEarTracker(baseline, cfg.calibration)
  const perclos = createPerclos(cfg.fatigue.perclosWindowMs, cfg.fatigue.perclosMinValidRatio)
  const slowBlinks = createEventCounter(cfg.fatigue.slowBlinkWindowMs)
  const yawns = createEventCounter(cfg.fatigue.yawnWindowMs)
  const nods = createEventCounter(cfg.fatigue.nodWindowMs)
  const yawn = createYawnDetector(cfg.fatigue, cfg.mouth)
  const nod = createNodDetector(cfg.fatigue, cfg.pose)
  let closedSince: number | null = null
  let shiftedSince: number | null = null

  function fatigueLevel(t: number, p: number | null): FatigueLevel {
    const f = cfg.fatigue
    const sb = slowBlinks.count(t)
    const y = yawns.count(t)
    const n = nods.count(t)
    if ((p !== null && p > f.perclosStrong) || sb >= f.slowBlinksStrong || y >= f.yawnsStrong || n >= f.nodsStrong) {
      return 'STRONG'
    }
    if ((p !== null && p > f.perclosAdvisory) || sb >= f.slowBlinksAdvisory || y >= f.yawnsAdvisory || n >= f.nodsAdvisory) {
      return 'ADVISORY'
    }
    return 'NONE'
  }

  return {
    update(frame, ctx) {
      const { smooth, sensor } = frame
      const t = smooth.t
      const seen = smooth.faceFound && smooth.pose !== undefined
      const usable = seen && frame.frameValid && smooth.eye !== undefined

      // --- Head pose relative to baseline ---
      const downDeg = seen && smooth.pose ? (smooth.pose.pitchDeg - baseline.pitchDeg) * cfg.pose.headDownSign : null
      const yawDeg = seen && smooth.pose ? smooth.pose.yawDeg - baseline.yawDeg : null

      // --- Eyes ---
      const range = ear.current()
      let openness: number | null = null
      if (usable && smooth.eye) {
        const e = smooth.eye
        const left = eyeOpenness(e.earL, e.blinkL, range, cfg.eye.earWeight)
        const right = eyeOpenness(e.earR, e.blinkR, range, cfg.eye.earWeight)
        // On a big head turn the far eye is foreshortened and unreliable: use the wider (nearer) one.
        openness =
          yawDeg !== null && Math.abs(yawDeg) > cfg.eye.farEyeYawDeg
            ? e.widthL >= e.widthR ? left : right
            : (left + right) / 2
      }
      const eyesClosed = openness === null ? null : openness < cfg.eye.closedBelow

      // Blink length → slow blinks (fatigue). Closures ≥ 1 s are microsleep, handled by the FSM.
      if (eyesClosed === true) closedSince ??= t
      else if (eyesClosed === false && closedSince !== null) {
        const ms = t - closedSince
        if (ms >= cfg.eye.blinkMaxMs && ms < cfg.eye.slowBlinkMaxMs) slowBlinks.add(t)
        closedSince = null
      } else if (eyesClosed === null) closedSince = null

      perclos.add(t, eyesClosed)
      const p = perclos.value(t)

      // --- Mouth ---
      let mouth: number | null = null
      if (usable && smooth.mouth) {
        const marNorm = clamp((smooth.mouth.mar - baseline.mar) / cfg.mouth.marSpan, 0, 1)
        mouth = cfg.mouth.jawWeight * clamp(smooth.mouth.jawOpen, 0, 1) + (1 - cfg.mouth.jawWeight) * marNorm
      }
      if (yawn.update(t, mouth)) yawns.add(t)
      if (nod.update(t, usable ? downDeg : null)) nods.add(t)

      // --- Off road (SPEC §10.3) ---
      let offRoad: boolean | null = null
      if (usable && downDeg !== null && yawDeg !== null) {
        const gazeDown = (smooth.gaze?.y ?? 0) - baseline.gazeY < cfg.offRoad.gazeDownBelow
        const headStraight = Math.abs(yawDeg) < cfg.alert.recoveryPoseDeg && Math.abs(downDeg) < cfg.alert.recoveryPoseDeg
        offRoad = Math.abs(yawDeg) > cfg.offRoad.yawDeg || downDeg > cfg.offRoad.pitchDownDeg || (headStraight && gazeDown)
      }

      // Degraded mode (eyes hidden) still needs this, so it does not require eye data — only a valid frame.
      const headDropped = downDeg === null || !frame.frameValid ? null : downDeg >= cfg.degraded.headDropDeg

      const recovered =
        usable &&
        openness !== null &&
        openness > cfg.eye.openAbove &&
        downDeg !== null &&
        yawDeg !== null &&
        Math.abs(downDeg) <= cfg.alert.recoveryPoseDeg &&
        Math.abs(yawDeg) <= cfg.alert.recoveryPoseDeg

      // --- Adapt the open-eye baseline only in calm, clearly-open moments ---
      const eligible =
        usable && !ctx.alarmActive && (p ?? 0) < cfg.fatigue.perclosAdvisory && openness !== null && openness > cfg.eye.openAbove
      if (smooth.eye) ear.update(t, (smooth.eye.earL + smooth.eye.earR) / 2, eligible)

      // --- Mount moved? Pose far from baseline for a long time (not a glance) ---
      const shifted =
        downDeg !== null &&
        yawDeg !== null &&
        (Math.abs(yawDeg) > cfg.calibration.recalibratePoseShiftDeg ||
          Math.abs(downDeg) > cfg.calibration.recalibratePoseShiftDeg)
      shiftedSince = shifted ? (shiftedSince ?? t) : null
      const needsRecalibration = shiftedSince !== null && t - shiftedSince >= cfg.calibration.recalibrateAfterMs

      const fatigue = fatigueLevel(t, p)
      return {
        signals: { t, sensor, eyesClosed, headDropped, offRoad, recovered, fatigue, armed: ctx.armed },
        debug: {
          openness,
          mouth,
          downDeg,
          yawDeg,
          perclos: p,
          slowBlinks: slowBlinks.count(t),
          yawns: yawns.count(t),
          nods: nods.count(t),
          ear: range,
          needsRecalibration,
        },
      }
    },
  }
}
