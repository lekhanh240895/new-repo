import { describe, expect, it } from 'vitest'
import { framesFrom, OPEN_EAR } from '../../test/frames.ts'
import { DEFAULT_CONFIG } from '../config.ts'
import { computeBaseline, DEFAULT_BASELINE, fallbackBaseline } from './baseline.ts'
import { createOnlineEarTracker } from './onlineEar.ts'

const cfg = DEFAULT_CONFIG.calibration
const open = (ms: number, spec = {}) => ({ ms, spec })
const blink = { ms: 200, spec: { ear: 0.06, blink: 0.9 } }

/** 8 s calibration with `n` blinks spread through it. */
function session(n: number, spec = {}) {
  const segs = [open(1000, spec)]
  for (let i = 0; i < n; i++) segs.push({ ...blink, spec: { ...blink.spec, ...spec } }, open(1800, spec))
  segs.push(open(8000 - 1000 - n * 2000, spec))
  return framesFrom(segs)
}

describe('computeBaseline (SPEC §9)', () => {
  it('learns open and closed EAR, pose and position', () => {
    const r = computeBaseline(session(3, { pitch: -4, yaw: 12, center: { x: 0.6, y: 0.4 } }), cfg)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.blinks).toBe(3)
    expect(r.baseline.earOpen).toBeCloseTo(OPEN_EAR)
    expect(r.baseline.earClosed).toBeCloseTo(0.06)
    expect(r.baseline.yawDeg).toBeCloseTo(12)
    expect(r.baseline.pitchDeg).toBeCloseTo(-4)
    expect(r.baseline.faceCenter).toEqual({ x: 0.6, y: 0.4 })
    expect(r.baseline.approximate).toBe(false)
  })

  it('adapts to narrow eyes instead of using a fixed threshold', () => {
    const r = computeBaseline(session(2, { ear: 0.18 }), cfg)
    expect(r.ok && r.baseline.earOpen).toBeCloseTo(0.18)
  })

  it('rejects when fewer than 2 blinks were seen, but keeps a partial baseline', () => {
    const r = computeBaseline(session(1), cfg)
    expect(r).toMatchObject({ ok: false, reason: 'no-blinks' })
    const b = fallbackBaseline(r)
    expect(b.approximate).toBe(true)
    expect(b.earOpen).toBeCloseTo(OPEN_EAR)
    expect(b.earClosed).toBeCloseTo(OPEN_EAR * cfg.closedFromOpenRatio)
  })

  it('rejects when the driver is moving', () => {
    const frames = framesFrom([
      open(2000, { yaw: 0 }), blink, open(2000, { yaw: 20 }), blink, open(2000, { yaw: -20 }), open(1600),
    ])
    expect(computeBaseline(frames, cfg)).toMatchObject({ ok: false, reason: 'moving' })
  })

  it('ignores a single quick glance when judging movement', () => {
    const frames = framesFrom([open(1000), blink, open(2000), { ms: 300, spec: { yaw: 35 } }, blink, open(4300)])
    expect(computeBaseline(frames, cfg).ok).toBe(true)
  })

  it('rejects when most frames are invalid; defaults if nothing was seen', () => {
    const r = computeBaseline(framesFrom([open(1000), { ms: 7000, spec: { faceFound: false } }]), cfg)
    expect(r).toMatchObject({ ok: false, reason: 'too-few-valid' })
    const none = computeBaseline(framesFrom([{ ms: 8000, spec: { faceFound: false } }]), cfg)
    expect(fallbackBaseline(none)).toEqual(DEFAULT_BASELINE)
  })

  it('never returns a jitter baseline of zero', () => {
    const r = computeBaseline(session(2, { jitter: 0 }), cfg)
    expect(r.ok && r.baseline.jitter).toBeGreaterThan(0)
  })
})

describe('online EAR tracker', () => {
  const base = { ...DEFAULT_BASELINE, earOpen: 0.3, earClosed: 0.09, approximate: false }

  it('stays at the calibrated value until it has a minute of samples', () => {
    const tr = createOnlineEarTracker(base, cfg)
    for (let t = 0; t < 30_000; t += 66) tr.update(t, 0.33, true)
    expect(tr.current().earOpen).toBe(0.3)
  })

  it('follows a real change, keeping the open/closed ratio', () => {
    const tr = createOnlineEarTracker(base, cfg)
    for (let t = 0; t < 120_000; t += 66) tr.update(t, 0.33, true)
    expect(tr.current().earOpen).toBeCloseTo(0.33)
    expect(tr.current().earClosed).toBeCloseTo(0.33 * 0.3)
  })

  it('cannot drift more than ±15% (does not learn drowsy eyes as normal)', () => {
    const tr = createOnlineEarTracker(base, cfg)
    for (let t = 0; t < 300_000; t += 66) tr.update(t, 0.12, true)
    expect(tr.current().earOpen).toBeCloseTo(0.3 * 0.85)
  })

  it('ignores ineligible and bad samples', () => {
    const tr = createOnlineEarTracker(base, cfg)
    for (let t = 0; t < 120_000; t += 66) {
      tr.update(t, 0.1, false)
      tr.update(t + 1, Number.NaN, true)
    }
    expect(tr.current().earOpen).toBe(0.3)
  })
})
