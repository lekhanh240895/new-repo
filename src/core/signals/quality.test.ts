import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.ts'
import type { FrameResult } from '../types.ts'
import { createQualityTracker } from './quality.ts'

const good = { faceLuma: 120, faceAreaRatio: 0.15, landmarkJitter: 0.002 }

function frame(t: number, patch: Partial<FrameResult> = {}, quality: Partial<FrameResult['quality']> = {}): FrameResult {
  return { t, inferMs: 10, faceFound: true, quality: { ...good, ...quality }, ...patch }
}

/** Feed frames every `stepMs` from `from` to `to`, return the last output. */
function feed(
  tracker: ReturnType<typeof createQualityTracker>,
  from: number,
  to: number,
  make: (t: number) => FrameResult,
  stepMs = 66,
) {
  let out = tracker.update(make(from))
  for (let t = from + stepMs; t <= to; t += stepMs) out = tracker.update(make(t))
  return out
}

describe('quality gates (SPEC §8.6)', () => {
  const cfg = DEFAULT_CONFIG.quality

  it('is OK for a good frame', () => {
    const q = createQualityTracker(cfg)
    expect(q.update(frame(0))).toMatchObject({ sensor: 'OK', frameValid: true })
  })

  it('face lost: OCCLUDED first, NO_FACE after 1.5 s', () => {
    const q = createQualityTracker(cfg)
    q.update(frame(0))
    expect(feed(q, 66, 1000, (t) => frame(t, { faceFound: false })).sensor).toBe('OCCLUDED')
    expect(feed(q, 1066, 1700, (t) => frame(t, { faceFound: false })).sensor).toBe('NO_FACE')
    expect(q.update(frame(1766))).toMatchObject({ sensor: 'OK', frameValid: true })
  })

  it('bad light becomes LOW_VISIBILITY only after 1 s', () => {
    const q = createQualityTracker(cfg)
    expect(feed(q, 0, 900, (t) => frame(t, {}, { faceLuma: 20 })).sensor).toBe('OK')
    expect(feed(q, 966, 1100, (t) => frame(t, {}, { faceLuma: 20 }))).toMatchObject({
      sensor: 'LOW_VISIBILITY',
      frameValid: false,
    })
  })

  it('no face in a dark frame is LOW_VISIBILITY (night), not just NO_FACE', () => {
    const q = createQualityTracker(cfg)
    expect(feed(q, 0, 1200, (t) => frame(t, { faceFound: false }, { faceLuma: 10 })).sensor).toBe('LOW_VISIBILITY')
  })

  it('too-small face counts as LOW_VISIBILITY', () => {
    const q = createQualityTracker(cfg)
    expect(feed(q, 0, 1200, (t) => frame(t, {}, { faceAreaRatio: 0.01 })).sensor).toBe('LOW_VISIBILITY')
  })

  it('heavy shake invalidates frames after 0.5 s, without changing the sensor state', () => {
    const q = createQualityTracker(cfg)
    // Gate is off until a calibration baseline exists.
    expect(feed(q, 0, 1000, (t) => frame(t, {}, { landmarkJitter: 1 })).frameValid).toBe(true)
    q.setBaselineJitter(0.002)
    expect(feed(q, 1066, 1400, (t) => frame(t, {}, { landmarkJitter: 0.01 })).frameValid).toBe(true)
    expect(feed(q, 1466, 1700, (t) => frame(t, {}, { landmarkJitter: 0.01 }))).toMatchObject({
      sensor: 'OK',
      frameValid: false,
    })
  })

  it('reports fps and flags DEGRADED when it stays under 8 fps', () => {
    const q = createQualityTracker(cfg)
    expect(feed(q, 0, 3000, (t) => frame(t)).fps).toBeCloseTo(15, 0)
    const slow = feed(q, 3200, 7000, (t) => frame(t), 200)
    expect(slow.fps).toBeLessThan(8)
    expect(slow.sensor).toBe('DEGRADED')
  })

  it('does not call start-up "slow"', () => {
    const q = createQualityTracker(cfg)
    expect(feed(q, 0, 400, (t) => frame(t), 200).sensor).toBe('OK')
  })
})
