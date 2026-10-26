/**
 * Signal pipeline tests, plus end-to-end core tests:
 * synthetic camera numbers → pipeline → state machine → effects.
 */
import { describe, expect, it } from 'vitest'
import { framesFrom, processed, type FrameSegment } from '../../test/frames.ts'
import { DEFAULT_BASELINE, type Baseline } from '../calibration/baseline.ts'
import { DEFAULT_CONFIG } from '../config.ts'
import { createSession, reduce } from '../fsm/session.ts'
import type { Effect, SessionState } from '../fsm/types.ts'
import { createSignalPipeline, eyeOpenness } from './pipeline.ts'

const cfg = DEFAULT_CONFIG
const BASE: Baseline = { ...DEFAULT_BASELINE, earOpen: 0.3, earClosed: 0.06, approximate: false }
const ctx = { armed: true, alarmActive: false }

const closed = { ear: 0.05, blink: 0.95 }

function monitoring(): SessionState {
  let s = createSession()
  for (const type of ['START', 'PERMISSIONS_GRANTED', 'MODEL_READY', 'SETUP_PASSED', 'CALIBRATION_DONE'] as const) {
    s = reduce(s, { type, t: 0 }).state
  }
  return s
}

/** Run segments through pipeline + FSM; return effect names in order. */
function drive(segments: readonly FrameSegment[], baseline = BASE): { effects: string[]; state: SessionState } {
  const pipe = createSignalPipeline(cfg, baseline)
  let state = monitoring()
  const effects: Effect[] = []
  for (const frame of framesFrom(segments)) {
    const { signals } = pipe.update(frame, { armed: true, alarmActive: state.monitoring.latched !== null })
    const r = reduce(state, { type: 'FRAME', signals })
    state = r.state
    effects.push(...r.effects)
  }
  const names = effects.map((e) => (e.type === 'alarm' ? `alarm:${e.level}` : e.type === 'speak' ? `speak:${e.message}` : e.type === 'chime' ? `chime:${e.kind}` : e.type))
  return { effects: names, state }
}

describe('eye openness fusion (SPEC §8.1)', () => {
  const range = { earOpen: 0.3, earClosed: 0.06 }
  it('is 1 for calibrated-open eyes and 0 for closed', () => {
    expect(eyeOpenness(0.3, 0, range, 0.6)).toBeCloseTo(1)
    expect(eyeOpenness(0.06, 1, range, 0.6)).toBeCloseTo(0)
  })
  it('uses the blendshape as a second opinion', () => {
    expect(eyeOpenness(0.3, 1, range, 0.6)).toBeCloseTo(0.6)
  })
})

describe('signal pipeline', () => {
  it('reports eyes closed, unknown when the face is lost', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0), ctx).signals.eyesClosed).toBe(false)
    expect(p.update(processed(66, closed), ctx).signals.eyesClosed).toBe(true)
    expect(p.update(processed(132, { faceFound: false }), ctx).signals.eyesClosed).toBeNull()
  })

  it('is relative to the calibrated pose (phone mounted to the side)', () => {
    const p = createSignalPipeline(cfg, { ...BASE, yawDeg: 25 })
    const s = p.update(processed(0, { yaw: 25 }), ctx)
    expect(s.signals.offRoad).toBe(false)
    expect(s.signals.recovered).toBe(true)
    expect(p.update(processed(66, { yaw: 60 }), ctx).signals.offRoad).toBe(true)
  })

  it('flags looking down: head down, or eyes down with head straight', () => {
    const p = createSignalPipeline(cfg, BASE)
    // headDownSign = −1: negative pitch is "down".
    expect(p.update(processed(0, { pitch: -25 }), ctx).signals.offRoad).toBe(true)
    expect(p.update(processed(66, { gazeY: -0.7 }), ctx).signals.offRoad).toBe(true)
    expect(p.update(processed(132, { gazeY: -0.2 }), ctx).signals.offRoad).toBe(false)
  })

  it('uses the nearer eye on a big head turn', () => {
    const p = createSignalPipeline(cfg, BASE)
    // Left eye far (narrow, looks closed), right eye near and open.
    const s = p.update(processed(0, { yaw: 35, earL: 0.05, earR: 0.3, widthL: 0.03, widthR: 0.09 }), ctx)
    expect(s.signals.eyesClosed).toBe(false)
  })

  it('reports head drop for degraded mode', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { pitch: -20 }), ctx).signals.headDropped).toBe(true)
    expect(p.update(processed(66, { pitch: -5 }), ctx).signals.headDropped).toBe(false)
  })

  it('passes the arming flag through', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0), { armed: false, alarmActive: false }).signals.armed).toBe(false)
  })

  it('asks to re-calibrate after the pose stays far from baseline for 30 s', () => {
    const p = createSignalPipeline(cfg, BASE)
    const frames = framesFrom([{ ms: 31_000, spec: { yaw: 20 } }])
    let last = false
    for (const f of frames) last = p.update(f, ctx).debug.needsRecalibration
    expect(last).toBe(true)
  })
})

describe('end to end: camera numbers → alerts', () => {
  it('normal driving with blinks: no alerts', () => {
    const segs = Array.from({ length: 20 }, () => [{ ms: 2800 }, { ms: 200, spec: closed }]).flat()
    expect(drive(segs).effects).toEqual([])
  })

  it('microsleep: eyes closed 2.2 s → L1, L2, L3, then stop + break prompt', () => {
    const { effects } = drive([{ ms: 2000 }, { ms: 2200, spec: closed }, { ms: 3000 }])
    expect(effects).toEqual(['alarm:L1', 'alarm:L2', 'alarm:L3', 'alarmStop', 'speak:takeBreak'])
  })

  it('narrow eyes are not "closed" once calibrated', () => {
    const narrow = { ...BASE, earOpen: 0.17, earClosed: 0.04 }
    expect(drive([{ ms: 10_000, spec: { ear: 0.17 } }], narrow).effects).toEqual([])
  })

  it('mirror check (1.5 s) is ignored; a 4 s look away alarms', () => {
    expect(drive([{ ms: 1000 }, { ms: 1500, spec: { yaw: 45 } }, { ms: 3000 }]).effects).toEqual([])
    expect(drive([{ ms: 1000 }, { ms: 4000, spec: { yaw: 45 } }, { ms: 3000 }]).effects).toEqual([
      'alarm:D1',
      'alarm:D2',
      'alarmStop',
    ])
  })

  it('looking down at a phone for 2.5 s → D1', () => {
    expect(drive([{ ms: 1000 }, { ms: 2500, spec: { gazeY: -0.8 } }]).effects).toEqual(['alarm:D1'])
  })

  it('three yawns in 10 minutes → fatigue advisory', () => {
    const yawn = [{ ms: 2000, spec: { jaw: 0.9, mar: 0.6 } }, { ms: 60_000 }]
    const { effects, state } = drive([{ ms: 1000 }, ...yawn, ...yawn, ...yawn])
    expect(effects).toEqual(['speak:fatigueAdvisory'])
    expect(state.monitoring.alert).toBe('ADVISORY')
  })

  it('talking (wide but short mouth openings) is never a yawn', () => {
    const talk = Array.from({ length: 300 }, (_, i) => ({ ms: 165, spec: { jaw: i % 2 === 0 ? 0.1 : 0.95, mar: 0.4 } }))
    const pipe = createSignalPipeline(cfg, BASE)
    let maxMouth = 0
    for (const f of framesFrom(talk)) maxMouth = Math.max(maxMouth, pipe.update(f, ctx).debug.mouth ?? 0)
    expect(maxMouth).toBeGreaterThan(cfg.fatigue.yawnOpenAbove) // really opens past the yawn level
    expect(drive(talk).effects).toEqual([])
  })

  it('high PERCLOS (eyes closed ~20% of the time in normal-length blinks) → fatigue', () => {
    const droopy = Array.from({ length: 55 }, () => [{ ms: 1100 }, { ms: 300, spec: closed }]).flat()
    const pipe = createSignalPipeline(cfg, BASE)
    let last = pipe.update(processed(0), ctx).debug
    for (const f of framesFrom(droopy)) last = pipe.update(f, ctx).debug
    expect(last.slowBlinks).toBe(0) // the advisory must come from PERCLOS, not slow blinks
    expect(last.perclos).toBeGreaterThan(cfg.fatigue.perclosAdvisory)
    expect(drive(droopy).effects[0]).toBe('speak:fatigueAdvisory')
  })
})
