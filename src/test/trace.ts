/**
 * Golden-trace helpers: describe a scenario as timed segments of fake
 * signals, run it through the reducer at a fixed frame rate, and collect
 * what happened. No camera or model needed.
 */
import { DEFAULT_CONFIG, type Config } from '../core/config.ts'
import { createSession, reduce } from '../core/fsm/session.ts'
import type { AlertLevel, Effect, SessionState } from '../core/fsm/types.ts'
import type { FrameSignals } from '../core/types.ts'

export const FPS = 15
export const FRAME_MS = 1000 / FPS

export interface Segment {
  ms: number;
  /** Signal values for this segment. Anything left out uses the "alert, looking ahead" default. */
  with?: Partial<Omit<FrameSignals, 't'>>;
}

export interface TimedEffect {
  t: number;
  effect: Effect;
}

export interface TraceResult {
  state: SessionState;
  effects: TimedEffect[];
  /** Alert level each time it changed. */
  alerts: { t: number; alert: AlertLevel }[];
}

function defaultsFor(patch: Partial<Omit<FrameSignals, 't'>>): Omit<FrameSignals, 't'> {
  const eyesClosed = patch.eyesClosed ?? false
  const offRoad = patch.offRoad ?? false
  return {
    sensor: 'OK',
    headDropped: null,
    fatigue: 'NONE',
    armed: true,
    eyesClosed,
    offRoad,
    recovered: eyesClosed === false && offRoad === false,
    ...patch,
  }
}

/** Walk a session from IDLE to MONITORING at time `t0`. */
export function monitoringSession(t0 = 0, cfg: Config = DEFAULT_CONFIG): SessionState {
  let s = createSession()
  const steps = [
    { type: 'START', t: t0 },
    { type: 'PERMISSIONS_GRANTED', t: t0 },
    { type: 'MODEL_READY', t: t0 },
    { type: 'SETUP_PASSED', t: t0 },
    { type: 'CALIBRATION_DONE', t: t0 },
  ] as const
  for (const e of steps) s = reduce(s, e, cfg).state
  if (s.phase !== 'MONITORING') throw new Error(`setup failed, ended in ${s.phase}`)
  return s
}

export function runTrace(
  segments: readonly Segment[],
  opts: { cfg?: Config; start?: SessionState; t0?: number } = {},
): TraceResult {
  const cfg = opts.cfg ?? DEFAULT_CONFIG
  const t0 = opts.t0 ?? 0
  let state = opts.start ?? monitoringSession(t0, cfg)
  // Whole-millisecond timestamps, like a real camera clock. Summing 66.67 ms
  // steps would drift (1999.999… instead of 2000) and make tests flaky.
  let frame = 0
  const effects: TimedEffect[] = []
  const alerts: { t: number; alert: AlertLevel }[] = []
  let lastAlert = state.monitoring.alert

  for (const seg of segments) {
    const frames = Math.round(seg.ms / FRAME_MS)
    const base = defaultsFor(seg.with ?? {})
    for (let i = 0; i < frames; i++) {
      const t = t0 + Math.round(frame * FRAME_MS)
      frame += 1
      const next = reduce(state, { type: 'FRAME', signals: { ...base, t } }, cfg)
      state = next.state
      for (const effect of next.effects) effects.push({ t, effect })
      if (state.monitoring.alert !== lastAlert) {
        lastAlert = state.monitoring.alert
        alerts.push({ t, alert: lastAlert })
      }
    }
  }
  return { state, effects, alerts }
}

/** Short readable form of the effects, for snapshot-style assertions. */
export function effectNames(effects: readonly TimedEffect[]): string[] {
  return effects.map(({ effect: e }) => {
    switch (e.type) {
      case 'alarm':
        return `alarm:${e.level}`
      case 'speak':
        return `speak:${e.message}`
      case 'chime':
        return `chime:${e.kind}`
      case 'log':
        return 'log'
      default:
        return e.type
    }
  })
}

export function firstTimeOf(result: TraceResult, name: string): number | undefined {
  const names = effectNames(result.effects)
  const i = names.indexOf(name)
  return i === -1 ? undefined : result.effects[i]?.t
}

/** Repeat a list of segments `n` times. */
export function repeat(n: number, segments: readonly Segment[]): Segment[] {
  return Array.from({ length: n }, () => segments).flat()
}
