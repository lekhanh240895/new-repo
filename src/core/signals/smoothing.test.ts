import { describe, expect, it } from 'vitest'
import type { FrameResult } from '../types.ts'
import { createSignalSmoother } from './smoothing.ts'

function frame(t: number, ear: number, faceFound = true): FrameResult {
  return {
    t,
    inferMs: 10,
    faceFound,
    quality: { faceLuma: 120, faceAreaRatio: 0.1, landmarkJitter: 0 },
    eye: { earL: ear, earR: ear, blinkL: 0, blinkR: 0, widthL: 0.1, widthR: 0.1 },
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

  it('follows an eye closing within about one frame (no alarm delay)', () => {
    const s = createSignalSmoother()
    let t = 0
    for (let i = 0; i < 30; i++) s.smooth(frame((t += 66), 0.3))
    const first = s.smooth(frame((t += 66), 0.05)).eye?.earL ?? 1
    const second = s.smooth(frame((t += 66), 0.05)).eye?.earL ?? 1
    // Openness threshold sits at 30% of the open–closed range: 0.05 + 0.3 × 0.25 = 0.125.
    expect(Math.min(first, second)).toBeLessThan(0.125)
  })

  it('still smooths small jitter on a still face', () => {
    const s = createSignalSmoother()
    let t = 0
    let maxDev = 0
    for (let i = 0; i < 200; i++) {
      const raw = 0.3 + (i % 2 === 0 ? 0.01 : -0.01)
      const out = s.smooth(frame((t += 66), raw)).eye?.earL ?? 0
      if (i > 20) maxDev = Math.max(maxDev, Math.abs(out - 0.3))
    }
    expect(maxDev).toBeLessThan(0.01)
  })
})
