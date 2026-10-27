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
/** Raw pitch for a head tilted `deg` degrees down, whatever the config sign is. */
const down = (deg: number) => deg * cfg.pose.headDownSign
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

  /** Feed the same look for `ms` (zones are debounced: a look must last 150 ms). */
  function hold(p: ReturnType<typeof createSignalPipeline>, from: number, ms: number, spec: Parameters<typeof processed>[1]) {
    let out = p.update(processed(from, spec), ctx)
    for (let t = from + 66; t <= from + ms; t += 66) out = p.update(processed(t, spec), ctx)
    return out
  }

  it('is relative to the calibrated pose (phone mounted to the side)', () => {
    const p = createSignalPipeline(cfg, { ...BASE, yawDeg: 25 })
    const s = hold(p, 0, 300, { yaw: 25 })
    expect(s.signals.offRoad).toBe(false)
    expect(s.signals.recovered).toBe(true)
    expect(hold(p, 400, 300, { yaw: 60 }).signals.offRoad).toBe(true)
  })

  it('flags looking down: head down, or eyes down with head straight', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(hold(p, 0, 300, { pitch: down(25) }).signals.offRoad).toBe(true)
    expect(hold(p, 400, 300, { gazeY: -0.7 }).signals.offRoad).toBe(true)
    expect(hold(p, 800, 300, { gazeY: -0.2 }).signals.offRoad).toBe(false)
  })

  it('ignores a one-frame blip (debounce)', () => {
    const p = createSignalPipeline(cfg, BASE)
    hold(p, 0, 300, {})
    expect(p.update(processed(366, { yaw: 60 }), ctx).signals.offRoad).toBe(false)
  })

  it('uses the nearer eye on a big head turn', () => {
    const p = createSignalPipeline(cfg, BASE)
    // Left eye far (narrow, looks closed), right eye near and open.
    const s = p.update(processed(0, { yaw: 35, earL: 0.05, earR: 0.3, widthL: 0.03, widthR: 0.09 }), ctx)
    expect(s.signals.eyesClosed).toBe(false)
  })

  it('reports head drop for degraded mode', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { pitch: down(20) }), ctx).signals.headDropped).toBe(true)
    expect(p.update(processed(66, { pitch: down(5) }), ctx).signals.headDropped).toBe(false)
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

  it('microsleep: eyes closed 2.2 s → L1, L2, L3, steps down to L1 once awake, then stop + break prompt', () => {
    const { effects } = drive([{ ms: 2000 }, { ms: 2200, spec: closed }, { ms: 3000 }])
    expect(effects).toEqual(['alarm:L1', 'alarm:L2', 'alarm:L3', 'alarm:L1', 'alarmStop', 'speak:takeBreak'])
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

describe('face lost: why? (T15)', () => {
  const lost = { faceFound: false }
  it('a fast head drop just before the loss counts as closed eyes (D03)', () => {
    const r = drive([{ ms: 3000 }, { ms: 140, spec: { pitch: down(15) } }, { ms: 140, spec: { pitch: down(30) } }, { ms: 2500, spec: lost }])
    expect(r.effects[0]).toBe('alarm:L1')
  })

  it('a fast turn to the side before the loss is a blind-spot check: quiet for 1.5 s (A07)', () => {
    expect(drive([{ ms: 3000 }, { ms: 140, spec: { yaw: -25 } }, { ms: 1200, spec: lost }, { ms: 3000 }]).effects).toEqual([])
  })

  it('…but the face staying away longer raises D1 (B06)', () => {
    expect(drive([{ ms: 3000 }, { ms: 140, spec: { yaw: -25 } }, { ms: 2500, spec: lost }]).effects).toContain('alarm:D1')
  })

  it('a slow, small move before the loss tells nothing: no assumption', () => {
    const p = createSignalPipeline(cfg, BASE)
    for (const f of framesFrom([{ ms: 1000 }, { ms: 1000, spec: { yaw: -5 } }])) p.update(f, ctx)
    const s = p.update(processed(2100, lost), ctx).signals
    expect(s.assumeOffRoad).toBeUndefined()
    expect(s.assumeClosed).toBeUndefined()
  })
})

describe('P4: robust eye closure (T8, T9)', () => {
  // Lids drop when looking down: openness ≈ 0.28, under the normal 0.3 "closed" line.
  const lowLidsDown = { ear: 0.1, blink: 0.55, gazeY: -0.8, lookY: -0.85 }

  it('looking down with low lids is not "closed" (C01, B01)', () => {
    const p = createSignalPipeline(cfg, BASE)
    const s = p.update(processed(0, lowLidsDown), ctx)
    expect(s.signals.eyesClosed).toBe(false)
    expect(s.debug.closedLine).toBeCloseTo(cfg.eye.closedBelow - cfg.eye.downGazeCorrection)
  })

  it('the same lids looking ahead are closed; really closed eyes looking down are too', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { ear: 0.1, blink: 0.55 }), ctx).signals.eyesClosed).toBe(true)
    expect(p.update(processed(66, { ...closed, gazeY: -0.8, lookY: -0.85 }), ctx).signals.eyesClosed).toBe(true)
  })

  it('iris and blendshape must agree on "down" (one noisy opinion is not enough)', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { ear: 0.1, blink: 0.55, gazeY: -0.8, lookY: 0.2 }), ctx).signals.eyesClosed).toBe(true)
  })

  it('a laugh, sneeze or yawn marks an expression, and it holds for 1 s', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { smile: 0.9 }), ctx).signals.expression).toBe(true)
    expect(p.update(processed(900), ctx).signals.expression).toBe(true)
    expect(p.update(processed(1100), ctx).signals.expression).toBeUndefined()
    expect(p.update(processed(1200, { jaw: 0.8, mar: 0.6 }), ctx).signals.expression).toBe(true)
  })

  it('a face that smiles at rest is not an expression; closed eyes alarm on time (replay clip)', () => {
    const smiler = { ...BASE, smile: 0.93 }
    const p = createSignalPipeline(cfg, smiler)
    expect(p.update(processed(0, { smile: 0.93 }), ctx).signals.expression).toBeUndefined()
    const r = drive([{ ms: 2000, spec: { smile: 0.93 } }, { ms: 2200, spec: { ...closed, smile: 0.94, squint: 0.87 } }], smiler)
    expect(r.effects).toEqual(['alarm:L1', 'alarm:L2', 'alarm:L3'])
  })

  it('laughing with squeezed eyes for 1.6 s: no microsleep alarm (C04)', () => {
    expect(drive([{ ms: 2000 }, { ms: 1600, spec: { ...closed, smile: 0.9, squint: 0.8 } }, { ms: 3000 }]).effects).toEqual([])
  })

  it('…but eyes still closed 2 s into the laugh do alarm', () => {
    expect(drive([{ ms: 2000 }, { ms: 2300, spec: { ...closed, smile: 0.9 } }]).effects[0]).toBe('alarm:L1')
  })

  it('shaky frames: clearly closed eyes still count (F06)', () => {
    const p = createSignalPipeline(cfg, BASE)
    expect(p.update(processed(0, { ...closed, valid: false }), ctx).signals.eyesClosed).toBe(true)
    // Not clearly closed: unknown, as before.
    expect(p.update(processed(66, { ear: 0.1, blink: 0.55, valid: false }), ctx).signals.eyesClosed).toBeNull()
  })
})

describe('P4: drowsy eyes that are not closed', () => {
  const heavyLids = { ear: 0.17, blink: 0.5 }

  it('heavy lids looking ahead for 3 s → drowsy (D01)', () => {
    const p = createSignalPipeline(cfg, BASE)
    let last = undefined as ReturnType<typeof p.update> | undefined
    for (const f of framesFrom([{ ms: 1000 }, { ms: 3200, spec: heavyLids }])) last = p.update(f, ctx)
    expect(last?.signals.drowsyEyes).toBe('heavy')
    expect(drive([{ ms: 1000 }, { ms: 4000, spec: heavyLids }]).effects[0]).toBe('alarm:L1')
  })

  it('heavy lids with the head tilted down are not trusted (C09)', () => {
    expect(drive([{ ms: 1000 }, { ms: 6000, spec: { ...heavyLids, pitch: down(10) } }]).effects).toEqual([])
  })

  it('heavy lids while looking down (phone, speedometer) are not drowsy', () => {
    expect(drive([{ ms: 1000 }, { ms: 6000, spec: { ...heavyLids, gazeY: -0.8, lookY: -0.8 } }]).effects).not.toContain('alarm:L1')
  })

  it('three near-microsleeps (0.85 s) within a minute → L1 (D09)', () => {
    const near = [{ ms: 850, spec: closed }, { ms: 10_000 }]
    const r = drive([{ ms: 1000 }, ...near, ...near, { ms: 850, spec: closed }, { ms: 1000 }])
    expect(r.effects[0]).toBe('alarm:L1')
  })

  it('two near-microsleeps are not enough', () => {
    const near = [{ ms: 850, spec: closed }, { ms: 10_000 }]
    expect(drive([{ ms: 1000 }, ...near, ...near]).effects).toEqual([])
  })
})

describe('P4: fatigue nods need drowsy eyes (T11)', () => {
  const nodTo = (pitch: number, eyes = {}) => [{ ms: 330, spec: { pitch, ...eyes } }, { ms: 2000 }]

  it('head drops and comes back with open eyes (bump, phone glance): no fatigue', () => {
    const p = createSignalPipeline(cfg, BASE)
    let fatigue = 'NONE'
    for (const f of framesFrom([{ ms: 1000 }, ...nodTo(down(20))])) fatigue = p.update(f, ctx).signals.fatigue
    expect(fatigue).toBe('NONE')
  })

  it('the same drop with closed eyes is a fatigue nod', () => {
    const p = createSignalPipeline(cfg, BASE)
    let fatigue = 'NONE'
    for (const f of framesFrom([{ ms: 1000 }, ...nodTo(down(20), closed)])) fatigue = p.update(f, ctx).signals.fatigue
    expect(fatigue).toBe('ADVISORY')
  })
})
