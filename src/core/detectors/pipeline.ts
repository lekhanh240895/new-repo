/**
 * Turns smoothed, quality-checked frames into the per-frame inputs of the
 * state machine (FrameSignals), relative to the driver's baseline (SPEC §8–§10).
 */
import { createOnlineEarTracker, type EarRange } from '../calibration/onlineEar.ts'
import type { Baseline } from '../calibration/baseline.ts'
import type { Config } from '../config.ts'
import { clamp } from '../stats.ts'
import { BLIND_SENSOR_STATES, type FatigueLevel, type FrameSignals, type GazeZone, type ProcessedFrame, type SpeedClass } from '../types.ts'
import { createBlinkTrend } from './blinkTrend.ts'
import { createNodDetector } from './nod.ts'
import { createEventCounter, createPerclos } from './windows.ts'
import { createYawnDetector } from './yawn.ts'
import { classifyZone, combinedGaze, createZoneTracker, eyeConsensus, speedClass, zonePolicy, type ZonePolicy } from './zones.ts'

/** Extra numbers for Debug mode and trip logs. */
export interface SignalDebug {
  /** Fused eye openness, 0 = closed, 1 = calibrated open. */
  openness: number | null;
  /** Openness below this counts as closed this frame (lower when looking down, T8). */
  closedLine: number;
  /** How far the eyes look down, 0–1 (iris and blendshape agree). */
  downGaze: number;
  expression: boolean;
  drowsyEyes: FrameSignals['drowsyEyes'] | null;
  /** Learned normal blink length (ms), null while learning. */
  blinkNormalMs: number | null;
  mouth: number | null;
  /** Head below baseline in degrees (positive = down). */
  downDeg: number | null;
  /** Head turn from baseline in degrees (> 0 = right). */
  yawDeg: number | null;
  /** Debounced gaze zone (null = cannot tell this frame). */
  zone: GazeZone | null;
  speedClass: SpeedClass | null;
  perclos: number | null;
  slowBlinks: number;
  yawns: number;
  nods: number;
  ear: EarRange;
  /** The phone mount seems to have moved: ask to re-calibrate (SPEC §12 F16). */
  needsRecalibration: boolean;
}

/** How the face was lost, from the head motion just before (T15). */
export type FaceLossKind = 'drop' | 'turnLeft' | 'turnRight'

export interface MotionState {
  /** Car turning rate from the gyroscope, °/s (> 0 = right); null = no sensor. */
  turnRate: number | null;
  /** The phone has been very still for a while (may be stopped). Used only without GPS. */
  still: boolean;
}

export interface PipelineContext {
  /** Car moving (or speed unknown). Used when `speedKmh` is not given. */
  armed: boolean;
  /** An alarm is active: do not adapt the baseline now. */
  alarmActive: boolean;
  /** GPS speed in km/h; null = no fix; undefined = location not used (then `armed` decides). */
  speedKmh?: number | null;
  motion?: MotionState;
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
  const blinkTrend = createBlinkTrend(cfg.blinkTrend)
  let nearMisses: number[] = []
  let lastExpressionT: number | null = null
  let heavySince: number | null = null
  let stare: { since: number; trail: { t: number; down: number }[] } | null = null
  const zones = createZoneTracker(cfg.zones.dwellMs)
  let lastPolicy: ZonePolicy = { offRoad: false, turningInto: false, d1Ms: cfg.offRoad.d1Ms, d2Ms: cfg.offRoad.d2Ms, countsTowardShare: false }
  let turningIntoSince: number | null = null
  // Recent raw head angles (not smoothed: the filter would hide a fast move) for T15.
  let headTrail: { t: number; yaw: number; down: number }[] = []
  let faceLoss: FaceLossKind | null | undefined

  /** Why the face was lost, from how the head moved just before (T15). */
  function classifyFaceLoss(t: number): FaceLossKind | null {
    const f = cfg.faceLoss
    const last = headTrail[headTrail.length - 1]
    const first = headTrail[0]
    // The face must have been seen just now; otherwise we cannot tell.
    if (last === undefined || first === undefined || t - last.t > f.lookbackMs) return null
    const span = Math.max(1, last.t - first.t) / 1000
    const downRate = (last.down - first.down) / span
    const yawRate = (last.yaw - first.yaw) / span
    // A head drop is checked first: missing a microsleep is worse than a false distraction.
    if (last.down >= f.dropDownDeg || (headTrail.length > 1 && downRate >= f.dropRateDegS)) return 'drop'
    if (Math.abs(last.yaw) >= f.turnAwayYawDeg || (headTrail.length > 1 && Math.abs(yawRate) >= f.turnAwayRateDegS)) {
      return (Math.abs(last.yaw) >= f.turnAwayYawDeg ? last.yaw : yawRate) > 0 ? 'turnRight' : 'turnLeft'
    }
    return null
  }

  function fatigueLevel(t: number, p: number | null): FatigueLevel {
    const f = cfg.fatigue
    const sb = slowBlinks.count(t)
    const y = yawns.count(t)
    const n = nods.count(t)
    if ((p !== null && p > f.perclosStrong) || sb >= f.slowBlinksStrong || y >= f.yawnsStrong || n >= f.nodsStrong) {
      return 'STRONG'
    }
    // Blinks much longer than this driver's normal: an early sign (E10).
    const trend = blinkTrend.tired(t)
    if ((p !== null && p > f.perclosAdvisory) || sb >= f.slowBlinksAdvisory || y >= f.yawnsAdvisory || n >= f.nodsAdvisory || trend) {
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

      // --- Head pose relative to baseline (physical directions: down > 0, right > 0) ---
      const downDeg = seen && smooth.pose ? (smooth.pose.pitchDeg - baseline.pitchDeg) * cfg.pose.headDownSign : null
      const yawDeg = seen && smooth.pose ? (smooth.pose.yawDeg - baseline.yawDeg) * cfg.pose.yawRightSign : null

      // --- Face lost: why? (T15) Decided once, at the moment of loss ---
      const rawPose = frame.raw.faceFound ? frame.raw.pose : undefined
      if (seen && rawPose !== undefined) {
        headTrail.push({
          t,
          yaw: (rawPose.yawDeg - baseline.yawDeg) * cfg.pose.yawRightSign,
          down: (rawPose.pitchDeg - baseline.pitchDeg) * cfg.pose.headDownSign,
        })
        headTrail = headTrail.filter((h) => h.t >= t - cfg.faceLoss.lookbackMs)
        faceLoss = undefined
      } else if (!seen) {
        if (faceLoss === undefined) faceLoss = classifyFaceLoss(t)
        headTrail = []
      }
      const lossKind = seen ? null : (faceLoss ?? null)

      // --- Eye direction: how far the eyes look down (iris and blendshape must agree) ---
      const eyeUp = usable ? eyeConsensus((smooth.gaze?.y ?? 0) - baseline.gazeY, smooth.eye?.lookY) : 0
      const downGaze = clamp(-eyeUp / cfg.eye.downGazeFull, 0, 1)

      // --- Mouth and expressions (T9) ---
      let mouth: number | null = null
      if (usable && smooth.mouth) {
        const marNorm = clamp((smooth.mouth.mar - baseline.mar) / cfg.mouth.marSpan, 0, 1)
        mouth = cfg.mouth.jawWeight * clamp(smooth.mouth.jawOpen, 0, 1) + (1 - cfg.mouth.jawWeight) * marNorm
      }
      const ex = cfg.expression
      const expressing =
        usable &&
        ((mouth ?? 0) >= ex.mouthAbove || (smooth.mouth?.smile ?? 0) >= Math.max(ex.smileAbove, baseline.smile + ex.smileRise))
      if (expressing) lastExpressionT = t
      const expression = lastExpressionT !== null && t - lastExpressionT <= ex.holdMs
      if (yawn.update(t, mouth)) yawns.add(t)

      // --- Eyes ---
      const range = ear.current()
      // A shaky frame (bumpy road) is not used for most signals, but clearly closed eyes still count (F06).
      const shaky = seen && !frame.frameValid && !BLIND_SENSOR_STATES.has(sensor) && smooth.eye !== undefined
      let openness: number | null = null
      if ((usable || shaky) && smooth.eye) {
        const e = smooth.eye
        const left = eyeOpenness(e.earL, e.blinkL, range, cfg.eye.earWeight)
        const right = eyeOpenness(e.earR, e.blinkR, range, cfg.eye.earWeight)
        // On a big head turn the far eye is foreshortened and unreliable: use the wider (nearer) one.
        openness =
          yawDeg !== null && Math.abs(yawDeg) > cfg.eye.farEyeYawDeg
            ? e.widthL >= e.widthR ? left : right
            : (left + right) / 2
      }
      // Looking down lowers the lids: move the "closed" line down (T8).
      const closedLine = cfg.eye.closedBelow - cfg.eye.downGazeCorrection * downGaze
      let eyesClosed: boolean | null = null
      if (openness !== null) {
        if (usable) eyesClosed = openness < closedLine
        else if (openness < cfg.eye.shakyClosedBelow) eyesClosed = true
      }
      // Fatigue statistics only use clean frames.
      const cleanClosed = usable ? eyesClosed : null

      // Blink length → slow blinks, blink trend, near-microsleeps. Closures ≥ 1 s are microsleep (FSM).
      let nearMissCluster = false
      if (cleanClosed === true) closedSince ??= t
      else if (cleanClosed === false && closedSince !== null) {
        const ms = t - closedSince
        if (ms >= cfg.eye.blinkMaxMs && ms < cfg.eye.slowBlinkMaxMs) slowBlinks.add(t)
        if (ms >= cfg.eye.blinkMinMs && ms < cfg.eye.slowBlinkMaxMs) blinkTrend.add(t, ms)
        if (ms >= cfg.drowsyEyes.nearMissMinMs && ms < cfg.microsleep.l1Ms) {
          nearMisses = [...nearMisses.filter((x) => x > t - cfg.drowsyEyes.nearMissWindowMs), t]
          if (nearMisses.length >= cfg.drowsyEyes.nearMissCount) {
            nearMissCluster = true
            // One alarm per cluster: start counting again.
            nearMisses = []
          }
        }
        closedSince = null
      } else if (cleanClosed === null) closedSince = null

      perclos.add(t, cleanClosed)
      const p = perclos.value(t)

      // Fatigue nod: the head drops and comes back, with drowsy eyes (T11). Lids low while
      // looking down at something (phone) are not drowsy.
      const drowsyLook = usable && openness !== null && (eyesClosed === true || (openness < cfg.drowsyEyes.heavyBelow && downGaze < 0.25))
      if (nod.update(t, usable ? downDeg : null, drowsyLook)) nods.add(t)

      // --- Where the driver looks: combined head + eyes → zone (T3), debounced (T6) ---
      let gazeYaw = 0
      let rawZone: GazeZone | null = null
      if (usable && downDeg !== null && yawDeg !== null) {
        const xSign = cfg.pose.gazeXRightSign
        const lookX = smooth.eye?.lookX
        const eyeRight = eyeConsensus((smooth.gaze?.x ?? 0) * xSign, lookX === undefined ? undefined : lookX * xSign)
        const g = combinedGaze(yawDeg, downDeg, eyeRight, eyeUp, cfg.zones)
        gazeYaw = g.yaw
        rawZone = classifyZone(g.yaw, g.pitch, zones.current(), cfg.zones)
      }
      const zone = zones.update(t, rawZone)
      // Turned away fast and the face is gone: a shoulder / blind-spot check (or the back seat).
      const assumedZone: GazeZone | null = lossKind === 'turnLeft' ? 'sideLeft' : lossKind === 'turnRight' ? 'sideRight' : null

      // --- Speed context (T1) and turning (T2) decide the budget for this zone ---
      const sc = ctx.speedKmh === undefined ? null : speedClass(ctx.speedKmh, ctx.motion?.still ?? false, cfg.speedContext)
      if (zone !== null) {
        let policy = zonePolicy(zone, gazeYaw, sc ?? 'unknown', ctx.motion?.turnRate ?? null, cfg)
        // Looking into a turn is driving — but not for ever (guard B15).
        turningIntoSince = policy.turningInto ? (turningIntoSince ?? t) : null
        if (turningIntoSince !== null && t - turningIntoSince >= cfg.motion.turnMaxMs) {
          // The eyes have already been off the road for turnMaxMs: no further budget, alarm now.
          const normal = zonePolicy(zone, gazeYaw, sc ?? 'unknown', null, cfg)
          policy = { ...normal, d1Ms: 0, d2Ms: cfg.budgets.escalateMs }
        }
        lastPolicy = policy
      } else if (assumedZone !== null) {
        const b = cfg.budgets
        lastPolicy = { offRoad: true, turningInto: false, d1Ms: b.blindSpotMs, d2Ms: b.blindSpotMs + b.escalateMs, countsTowardShare: false }
      }
      // Face lost: keep the last zone's budget; the state machine decides how to carry the time.
      const offRoad = zone === null ? null : lastPolicy.offRoad
      const armedD = sc === null ? ctx.armed : sc !== 'stopped' && sc !== 'maneuver'
      const armedL = sc === null ? ctx.armed : sc !== 'stopped'

      // Degraded mode (eyes hidden) still needs this, so it does not require eye data — only a valid frame.
      const headDropped = downDeg === null || !frame.frameValid ? null : downDeg >= cfg.degraded.headDropDeg

      // --- Drowsy eyes that are not closed (D01, D02): only when looking ahead, not down, no expression ---
      const dz = cfg.drowsyEyes
      const ahead = usable && (zone === 'road' || zone === 'up') && downGaze < 0.25 && !expression
      const lowLids = ahead && openness !== null && eyesClosed === false
      const level = downDeg !== null && Math.abs(downDeg) <= dz.heavyMaxPitchDeg
      heavySince = lowLids && level && (openness ?? 1) < dz.heavyBelow ? (heavySince ?? t) : null
      const heavy = heavySince !== null && t - heavySince >= dz.heavyMs
      // Stare: lids lower than usual with no blink while the head keeps slowly sinking.
      let staring = false
      if (lowLids && (openness ?? 1) < dz.stareBelow && downDeg !== null) {
        stare ??= { since: t, trail: [] }
        stare.trail = [...stare.trail.filter((h) => h.t >= t - dz.stareSinkWindowMs), { t, down: downDeg }]
        const oldest = stare.trail[0]
        const windowFull = oldest !== undefined && t - stare.since >= dz.stareSinkWindowMs
        staring = windowFull && t - stare.since >= dz.stareMs && downDeg - oldest.down >= dz.stareSinkDeg
      } else {
        stare = null
      }
      const drowsyEyes: FrameSignals['drowsyEyes'] | null = nearMissCluster ? 'nearMiss' : heavy ? 'heavy' : staring ? 'stare' : null

      // Recovered: eyes clearly open and looking at the road (head and eyes combined).
      const recovered = usable && openness !== null && openness > cfg.eye.openAbove && (zone === 'road' || zone === 'up')

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
        signals: {
          t,
          sensor,
          eyesClosed,
          headDropped,
          offRoad,
          recovered,
          fatigue,
          armed: ctx.armed,
          armedD,
          armedL,
          ...(zone !== null && { zone }),
          ...(assumedZone !== null && { zone: assumedZone, assumeOffRoad: true }),
          ...(lossKind === 'drop' && { assumeClosed: true }),
          ...(expression && { expression }),
          ...(drowsyEyes !== null && { drowsyEyes }),
          offRoadD1Ms: lastPolicy.d1Ms,
          offRoadD2Ms: lastPolicy.d2Ms,
          countsTowardShare: lastPolicy.countsTowardShare,
        },
        debug: {
          openness,
          closedLine,
          downGaze,
          expression,
          drowsyEyes,
          blinkNormalMs: blinkTrend.normalMs(),
          mouth,
          downDeg,
          yawDeg,
          zone,
          speedClass: sc,
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
