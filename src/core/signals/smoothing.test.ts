import { describe, expect, it } from 'vitest'
import type { FrameResult } from '../types.ts'
import { createSignalSmoother } from './smoothing.ts'

function frame(t: number, ear: number, faceFound = true): FrameResult {
  return {
    t,
    inferMs: 10,
    faceFound,
    quality: { faceLuma: 120, faceAreaRatio: 0.1, landmarkJitter: 0 },
    eye: { earL: ear, earR: ear, blinkL: 0, blinkR: 0 },
    pose: { pitchDeg: 0, yawDeg: 0, rollDeg: 0 },
  }
}

describe('signal smoother', () => {
  it('smooths signals and keeps other fields', () => {
    const s = createSignalSmoother()
    s.smooth(frame(0, 0.3))
    const out = s.smooth(frame(66, 0.32))
    expect(out.eye?.earL).toBeGreaterThan(0.3)
    expect(out.eye?.earL).toBeLessThan(0.32)
    expect(out.quality.faceLuma).toBe(120)
    expect(out.mouth).toBeUndefined()
  })

  it('resets when the face is lost, so old values do not leak in', () => {
    const s = createSignalSmoother()
    s.smooth(frame(0, 0.3))
    s.smooth(frame(66, 0.3, false))
    expect(s.smooth(frame(132, 0.1)).eye?.earL).toBe(0.1)
  })
})
