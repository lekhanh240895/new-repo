/**
 * Judges a real recorded clip with the same code as the synthetic scenarios:
 * the frames come from the real MediaPipe model (scripts/replay.mjs debug
 * mode); calibration uses the clip's first seconds, like a real trip.
 */
import { computeBaseline, fallbackBaseline } from '../core/calibration/baseline.ts'
import { DEFAULT_CONFIG, type Config } from '../core/config.ts'
import { createQualityTracker } from '../core/signals/quality.ts'
import { createSignalSmoother } from '../core/signals/smoothing.ts'
import type { FrameResult, ProcessedFrame } from '../core/types.ts'
import { describeTimeline, evaluateAll, playFrames, type PlayFrame } from '../scenarios/runner.ts'
import type { ClipEntry, SignWindows } from './manifest.ts'

export interface ClipResult {
  id: string;
  status: 'pass' | 'fail';
  reasons: string[];
  /** Effects, in seconds from the start of the clip. */
  timeline: string[];
  /** How calibration went: a failed calibration makes the result less trustworthy. */
  calibration: string;
  faceFoundRatio: number;
}

function speedAt(entry: ClipEntry, sec: number): number | null {
  let kmh: number | null = 60
  for (const s of [...entry.speed].sort((a, b) => a.at - b.at)) if (s.at <= sec) kmh = s.kmh
  return kmh
}

/**
 * `videoStartT`: page time when the video started (the replay's cameraOpenedAt). The model
 * loads after the camera opens, so the first analyzed frame comes later; marks count from
 * the video start. Default: the first frame.
 */
export function checkClip(samples: readonly FrameResult[], entry: ClipEntry, cfg: Config = DEFAULT_CONFIG, videoStartT?: number): ClipResult {
  const first = samples[0]
  if (first === undefined) {
    return { id: entry.id, status: 'fail', reasons: ['no frames (did the replay run?)'], timeline: [], calibration: 'none', faceFoundRatio: 0 }
  }
  const t0 = videoStartT ?? first.t
  // Work in clip time (ms from the video start), so every number in the report matches the video.
  const clip = samples.map((f) => ({ ...f, t: f.t - t0 }))
  const sec = (f: FrameResult) => f.t / 1000
  const [calFrom, calTo] = entry.calibrate

  // Calibrate like the app does: quality gates + smoothing over the calibration window.
  const quality = createQualityTracker(cfg.quality)
  const smoother = createSignalSmoother()
  const calFrames: ProcessedFrame[] = clip
    .filter((f) => sec(f) >= calFrom && sec(f) < calTo)
    .map((raw) => ({ raw, smooth: smoother.smooth(raw), ...quality.update(raw) }))
  const cal = computeBaseline(calFrames, cfg.calibration)
  const baseline = fallbackBaseline(cal)
  const calibration = cal.ok ? `ok (${cal.blinks} blinks)` : `failed: ${cal.reason}${cal.partial ? ', using partial values' : ', using defaults'}`

  const frames: PlayFrame[] = clip
    .filter((f) => sec(f) >= calTo)
    .map((raw) => {
      const kmh = speedAt(entry, sec(raw))
      return { raw, ctx: { speed: kmh, location: true } }
    })
  const { effects, endT } = playFrames(frames, baseline, cfg)
  const marks = new Map(Object.entries(entry.marks).map(([k, v]) => [k, v * 1000]))
  const reasons = evaluateAll(entry.expect, effects, marks, endT)
  const found = samples.filter((f) => f.faceFound).length
  return {
    id: entry.id,
    status: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    timeline: describeTimeline(effects),
    calibration,
    faceFoundRatio: found / samples.length,
  }
}

// ---------------------------------------------------------------- sign check

export interface SignFinding {
  /** Config value, e.g. "pose.yawRightSign". */
  setting: string;
  /** What moved, from straight ahead to the test pose. */
  measured: string;
  current: number;
  /** null = could not tell (the movement was too small or not recorded). */
  recommended: number | null;
  ok: boolean | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}

/**
 * From a short clip where the driver looks straight, turns the head right,
 * tilts it down, then moves only the eyes right and down: are the sign
 * conventions in the config right for this phone and browser?
 */
export function signCheck(samples: readonly FrameResult[], w: SignWindows, cfg: Config = DEFAULT_CONFIG, videoStartT?: number): SignFinding[] {
  const t0 = videoStartT ?? samples[0]?.t ?? 0
  const inWin = (win: [number, number] | undefined) =>
    win === undefined ? [] : samples.filter((f) => f.faceFound && (f.t - t0) / 1000 >= win[0] && (f.t - t0) / 1000 < win[1])
  const med = (win: [number, number] | undefined, pick: (f: FrameResult) => number | undefined) =>
    median(inWin(win).flatMap((f) => { const v = pick(f); return v === undefined || !Number.isFinite(v) ? [] : [v] }))
  const delta = (win: [number, number] | undefined, pick: (f: FrameResult) => number | undefined) => {
    const a = med(w.straight, pick)
    const b = med(win, pick)
    return a === null || b === null ? null : b - a
  }
  // Why a window has no value: no frames at all, or frames without a face (turned too far, out of frame).
  const missing = (win: [number, number] | undefined) => {
    if (win === undefined) return 'not recorded'
    const all = samples.filter((f) => (f.t - t0) / 1000 >= win[0] && (f.t - t0) / 1000 < win[1])
    if (all.length === 0) return `not recorded (no frames in ${win[0]}–${win[1]} s)`
    const lost = all.filter((f) => !f.faceFound).length
    return `not recorded (face lost in ${Math.round((lost / all.length) * 100)}% of ${win[0]}–${win[1]} s)`
  }
  const finding = (setting: string, d: number | null, min: number, current: number, unit: string, win?: [number, number]): SignFinding => {
    if (d === null || Math.abs(d) < min) {
      return { setting, measured: d === null ? missing(inWin(w.straight).length === 0 ? w.straight : win) : `${d.toFixed(2)}${unit} (too small)`, current, recommended: null, ok: null }
    }
    const recommended = Math.sign(d)
    return { setting, measured: `${d > 0 ? '+' : ''}${d.toFixed(2)}${unit}`, current, recommended, ok: recommended === current }
  }

  // The model often loses a face turned to the side (glasses, profile). Then the frames
  // just before and after the loss still show which way the head went: use them if at
  // least two of them moved past the threshold, all the same way.
  const yawFinding = (): SignFinding => {
    const setting = 'pose.yawRightSign'
    const current = cfg.pose.yawRightSign
    const d = delta(w.headRight, (f) => f.pose?.yawDeg)
    const straight = med(w.straight, (f) => f.pose?.yawDeg)
    if (d !== null || w.headRight === undefined || straight === null) return finding(setting, d, 10, current, '° yaw', w.headRight)
    const edges = inWin([w.headRight[0] - 1.5, w.headRight[1] + 1.5]).flatMap((f) => {
      const v = f.pose?.yawDeg
      return v === undefined || Math.abs(v - straight) < 10 ? [] : [v - straight]
    })
    const signs = new Set(edges.map(Math.sign))
    if (edges.length < 2 || signs.size !== 1) return finding(setting, null, 10, current, '° yaw', w.headRight)
    const e = edges.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))
    const recommended = Math.sign(e)
    return { setting, measured: `${e > 0 ? '+' : ''}${e.toFixed(2)}° yaw (edges of the turn, face lost in the middle)`, current, recommended, ok: recommended === current }
  }

  const out: SignFinding[] = [
    // downDeg = (pitch − baseline) × headDownSign must be > 0 when the head goes down.
    finding('pose.headDownSign', delta(w.headDown, (f) => f.pose?.pitchDeg), 8, cfg.pose.headDownSign, '° pitch', w.headDown),
    // yawDeg = (yaw − baseline) × yawRightSign must be > 0 when the head turns right.
    yawFinding(),
    // Eyes right: gaze.x × gazeXRightSign must be > 0.
    finding('pose.gazeXRightSign', delta(w.eyesRight, (f) => f.gaze?.x), 0.1, cfg.pose.gazeXRightSign, ' iris x', w.eyesRight),
  ]
  // The blendshape opinion must move the same way as the iris, or the consensus (T3) cancels it.
  const irisX = delta(w.eyesRight, (f) => f.gaze?.x)
  const blendX = delta(w.eyesRight, (f) => f.eye?.lookX)
  if (irisX !== null && blendX !== null && Math.abs(irisX) >= 0.1 && Math.abs(blendX) >= 0.1) {
    out.push({ setting: 'blendshape lookX agrees with iris x', measured: `iris ${irisX.toFixed(2)}, blendshape ${blendX.toFixed(2)}`, current: 1, recommended: Math.sign(irisX) === Math.sign(blendX) ? 1 : -1, ok: Math.sign(irisX) === Math.sign(blendX) })
  }
  // Eyes down must read y < 0 for both opinions (gaze zones and the down-gaze lid correction, T8).
  for (const [name, pick] of [['iris y when looking down', (f: FrameResult) => f.gaze?.y], ['blendshape lookY when looking down', (f: FrameResult) => f.eye?.lookY]] as const) {
    const d = delta(w.eyesDown, pick)
    out.push(d === null || Math.abs(d) < 0.1
      ? { setting: name, measured: d === null ? missing(w.eyesDown) : `${d.toFixed(2)} (too small)`, current: -1, recommended: null, ok: null }
      : { setting: name, measured: d.toFixed(2), current: -1, recommended: Math.sign(d), ok: d < 0 })
  }
  return out
}
