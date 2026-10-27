/**
 * Plays a scenario through the real monitoring chain:
 * FrameResult → quality gates → smoothing → detectors → state machine.
 * Calibration is skipped (the scenario gives the baseline).
 */
import { DEFAULT_BASELINE, type Baseline } from '../core/calibration/baseline.ts'
import { DEFAULT_CONFIG, type Config } from '../core/config.ts'
import { createSignalPipeline } from '../core/detectors/pipeline.ts'
import { alertRank, createSession, reduce } from '../core/fsm/index.ts'
import type { AlarmLevel, Effect, SessionState } from '../core/fsm/types.ts'
import { createQualityTracker } from '../core/signals/quality.ts'
import { createSignalSmoother } from '../core/signals/smoothing.ts'
import type { FrameResult, ProcessedFrame } from '../core/types.ts'
import { isArmed } from '../platform/speed.ts'
import type { Context, Expectation, Look, Scenario } from './types.ts'

export type ScenarioStatus = 'pass' | 'fail' | 'clip'

export interface ScenarioResult {
  id: string;
  status: ScenarioStatus;
  /** Why it failed (one line per broken expectation). */
  reasons: string[];
  /** Short timeline of what the app did, e.g. "2.1s alarm:D1". */
  timeline: string[];
}

interface TimedEffect {
  t: number;
  effect: Effect;
}

export const SCENARIO_BASELINE: Readonly<Baseline> = Object.freeze({
  ...DEFAULT_BASELINE,
  earOpen: 0.3,
  earClosed: 0.06,
  mar: 0.05,
  jitter: 0.004,
  faceCenter: { x: 0.5, y: 0.45 },
  faceArea: 0.15,
  approximate: false,
})

const DEFAULT_CTX: Required<Pick<Context, 'speed' | 'location'>> = { speed: 50, location: true }

/**
 * Builds what the vision worker would report for this look. Scenarios use
 * physical directions; the config sign conventions map them to raw values,
 * so flipping a sign after a device test never silently inverts the suite.
 */
export function frameFor(t: number, look: Look = {}, cfg: Config = DEFAULT_CONFIG): FrameResult {
  const luma = look.luma ?? 120
  if (look.face === false) {
    return { t, inferMs: 20, faceFound: false, quality: { faceLuma: luma, faceAreaRatio: 0, landmarkJitter: 0 } }
  }
  const ear = look.ear ?? 0.3
  const blink = look.blink ?? 0.05
  const gazeX = look.gazeX ?? 0
  const gazeY = look.gazeY ?? 0
  // Blendshape eye direction: agrees with the iris unless the scenario says otherwise.
  const lookY = look.future?.eyeLookDown !== undefined ? -look.future.eyeLookDown : gazeY
  return {
    t,
    inferMs: 20,
    faceFound: true,
    quality: {
      faceLuma: luma,
      faceAreaRatio: look.area ?? 0.15,
      landmarkJitter: look.jitter ?? 0.004,
      faceCenter: { x: 0.5, y: 0.45 },
    },
    eye: {
      earL: look.earL ?? ear,
      earR: look.earR ?? ear,
      blinkL: look.blinkL ?? blink,
      blinkR: look.blinkR ?? blink,
      widthL: look.widthL ?? 0.08,
      widthR: look.widthR ?? 0.08,
      lookX: gazeX * cfg.pose.gazeXRightSign,
      lookY,
    },
    mouth: { mar: look.mar ?? 0.05, jawOpen: look.jaw ?? 0.02 },
    pose: {
      pitchDeg: -(look.pitch ?? 0) * cfg.pose.headDownSign,
      yawDeg: (look.yaw ?? 0) * cfg.pose.yawRightSign,
      rollDeg: 0,
    },
    gaze: { x: gazeX * cfg.pose.gazeXRightSign, y: gazeY },
  }
}

function monitoringSession(): SessionState {
  let s = createSession()
  for (const type of ['START', 'PERMISSIONS_GRANTED', 'MODEL_READY', 'SETUP_PASSED', 'CALIBRATION_DONE'] as const) {
    s = reduce(s, { type, t: 0 }).state
  }
  return s
}

const ADVISORY = new Set(['fatigueAdvisory', 'fatigueStrong'])

function family(level: AlarmLevel): 'D' | 'L' {
  return level.startsWith('D') ? 'D' : 'L'
}

function describe(e: TimedEffect): string | null {
  const s = `${(e.t / 1000).toFixed(1)}s`
  const x = e.effect
  if (x.type === 'alarm') return `${s} alarm:${x.level}`
  if (x.type === 'alarmStop') return `${s} stop`
  if (x.type === 'speak') return `${s} speak:${x.message}`
  if (x.type === 'chime') return `${s} chime:${x.kind}`
  return null
}

/** Checks one expectation. Returns null if it holds, else the reason. */
function evaluate(exp: Expectation, effects: readonly TimedEffect[], marks: ReadonlyMap<string, number>, endT: number): string | null {
  const at = (name: string | undefined, fallback: number): number | null => {
    if (name === undefined) return fallback
    const t = marks.get(name)
    return t === undefined ? null : t
  }
  const alarms = effects.flatMap((e) => (e.effect.type === 'alarm' ? [{ t: e.t, level: e.effect.level }] : []))

  switch (exp.kind) {
    case 'noAlarm': {
      const from = at(exp.from, 0)
      const to = at(exp.to, endT)
      if (from === null || to === null) return `unknown mark ${exp.from ?? exp.to}`
      const bad = alarms.find((a) => a.t >= from && a.t <= to && (exp.family === undefined || family(a.level) === exp.family))
      return bad ? `unexpected ${bad.level} at ${(bad.t / 1000).toFixed(1)}s` : null
    }
    case 'alarm': {
      const from = at(exp.after, 0)
      if (from === null) return `unknown mark ${exp.after}`
      const hit = alarms.find((a) => family(a.level) === exp.family && a.t >= from && a.t <= from + exp.within)
      if (hit) return null
      const late = alarms.find((a) => family(a.level) === exp.family && a.t > from)
      return late
        ? `${exp.family} alarm too late: ${((late.t - from) / 1000).toFixed(1)}s after ${exp.after ?? 'start'} (limit ${exp.within / 1000}s)`
        : `missing ${exp.family} alarm after ${exp.after ?? 'start'}`
    }
    case 'noLevel': {
      const bad = alarms.find((a) => a.level === exp.level)
      return bad ? `unexpected ${exp.level} at ${(bad.t / 1000).toFixed(1)}s` : null
    }
    case 'advisory': {
      const from = at(exp.after, 0)
      if (from === null) return `unknown mark ${exp.after}`
      const hit = effects.find(
        (e) => e.effect.type === 'speak' && ADVISORY.has(e.effect.message) && e.t >= from && e.t <= from + exp.within,
      )
      return hit ? null : `missing fatigue advisory within ${exp.within / 1000}s after ${exp.after ?? 'start'}`
    }
    case 'noAdvisory': {
      const bad = effects.find((e) => e.effect.type === 'speak' && ADVISORY.has(e.effect.message))
      return bad ? `unexpected fatigue advisory at ${(bad.t / 1000).toFixed(1)}s` : null
    }
    case 'stops': {
      const from = at(exp.after, 0)
      if (from === null) return `unknown mark ${exp.after}`
      const hit = effects.find((e) => e.effect.type === 'alarmStop' && e.t >= from && e.t <= from + exp.within)
      if (hit) return null
      const late = effects.find((e) => e.effect.type === 'alarmStop' && e.t > from)
      return late
        ? `alarm stopped too late: ${((late.t - from) / 1000).toFixed(1)}s after ${exp.after} (limit ${exp.within / 1000}s)`
        : `alarm did not stop after ${exp.after}`
    }
    case 'deescalates': {
      const from = at(exp.after, 0)
      if (from === null) return `unknown mark ${exp.after}`
      const before = [...alarms].reverse().find((a) => a.t <= from)
      if (!before) return `no alarm active at ${exp.after}`
      const hit = effects.find(
        (e) =>
          e.t > from &&
          e.t <= from + exp.within &&
          (e.effect.type === 'alarmStop' || (e.effect.type === 'alarm' && alertRank(e.effect.level) < alertRank(before.level))),
      )
      return hit ? null : `alarm did not step down within ${exp.within / 1000}s after ${exp.after}`
    }
    case 'maxAlarms': {
      // Count episodes: an alarm that starts from silence (escalations inside one episode do not count).
      let active = false
      let n = 0
      for (const e of effects) {
        if (e.effect.type === 'alarm') {
          if (!active && family(e.effect.level) === exp.family) n++
          active = true
        } else if (e.effect.type === 'alarmStop') {
          active = false
        }
      }
      return n <= exp.count ? null : `${n} ${exp.family} alarm episodes (max ${exp.count})`
    }
    case 'chime': {
      const hit = effects.find((e) => e.effect.type === 'chime' && e.effect.kind === exp.chime)
      return hit ? null : `missing chime ${exp.chime}`
    }
  }
}

export function runScenario(s: Scenario, cfg: Config = DEFAULT_CONFIG): ScenarioResult {
  if (s.clipOnly !== undefined) return { id: s.id, status: 'clip', reasons: [s.clipOnly], timeline: [] }

  if (s.check) {
    let reason: string | null
    try {
      reason = s.check()
    } catch (err) {
      reason = `check threw: ${err instanceof Error ? err.message : String(err)}`
    }
    return { id: s.id, status: reason === null ? 'pass' : 'fail', reasons: reason === null ? [] : [reason], timeline: [] }
  }

  const segments = s.segments ?? []
  const fps = s.fps ?? 15
  const baseline: Baseline = { ...SCENARIO_BASELINE, ...s.baseline }
  const quality = createQualityTracker(cfg.quality)
  quality.setBaselineJitter(baseline.jitter)
  const smoother = createSignalSmoother()
  const pipeline = createSignalPipeline(cfg, baseline)
  let session = monitoringSession()
  const effects: TimedEffect[] = []
  const marks = new Map<string, number>()

  let frame = 0
  let t = 0
  for (const seg of segments) {
    const startT = Math.round((frame * 1000) / fps)
    if (seg.mark !== undefined) marks.set(seg.mark, startT)
    const ctx = { ...DEFAULT_CTX, ...s.ctx, ...seg.ctx }
    const n = Math.max(1, Math.round((seg.ms * fps) / 1000))
    for (let i = 0; i < n; i++) {
      t = Math.round((frame * 1000) / fps)
      frame++
      const raw = frameFor(t, seg.look, cfg)
      const processed: ProcessedFrame = { raw, smooth: smoother.smooth(raw), ...quality.update(raw) }
      const armed = ctx.location ? isArmed(ctx.speed, cfg.speed.armAboveKmh) : true
      const out = pipeline.update(processed, {
        armed,
        alarmActive: session.monitoring.latched !== null,
        // Decisions 2 and 3: location and motion sensors are on by default.
        ...(ctx.location && { speedKmh: ctx.speed }),
        motion: { turnRate: ctx.turn ?? 0, still: ctx.accelStill ?? false },
      })
      const r = reduce(session, { type: 'FRAME', signals: out.signals }, cfg)
      session = r.state
      for (const effect of r.effects) effects.push({ t, effect })
    }
  }

  const reasons = (s.expect ?? []).flatMap((e) => {
    const r = evaluate(e, effects, marks, t)
    return r === null ? [] : [r]
  })
  const timeline = effects.flatMap((e) => {
    const d = describe(e)
    return d === null ? [] : [d]
  })
  return { id: s.id, status: reasons.length === 0 ? 'pass' : 'fail', reasons, timeline }
}
