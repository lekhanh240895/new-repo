import { describe, expect, it } from 'vitest'
import { createMotionEstimator, turnRateFrom } from './motion.ts'

describe('turn rate from gravity + gyroscope (T2)', () => {
  it('works for a phone standing upright (portrait)', () => {
    // Upright: "up" is the device y axis. Turning left = +rotation around up.
    expect(turnRateFrom({ x: 0, y: 9.8, z: 0 }, { x: 0, y: 20, z: 0 })).toBeCloseTo(-20)
    expect(turnRateFrom({ x: 0, y: 9.8, z: 0 }, { x: 0, y: -15, z: 0 })).toBeCloseTo(15)
  })

  it('works for a phone lying flat or in landscape: only rotation around "up" counts', () => {
    expect(turnRateFrom({ x: 0, y: 0, z: 9.8 }, { x: 30, y: 0, z: 10 })).toBeCloseTo(-10)
    expect(turnRateFrom({ x: 9.8, y: 0, z: 0 }, { x: -12, y: 50, z: 50 })).toBeCloseTo(12)
  })

  it('returns null without gravity', () => {
    expect(turnRateFrom({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBeNull()
  })
})

describe('motion estimator', () => {
  const up = { x: 0, y: 9.8, z: 0 }
  function feed(e: ReturnType<typeof createMotionEstimator>, from: number, ms: number, sample: (t: number) => { accG: typeof up; rot: typeof up }) {
    for (let t = from; t < from + ms; t += 16) e.add({ t, ...sample(t) })
  }

  it('reports a steady right turn', () => {
    const e = createMotionEstimator()
    feed(e, 0, 1000, () => ({ accG: up, rot: { x: 0, y: -20, z: 0 } }))
    expect(e.state(1000).turnRate).toBeCloseTo(20, 0)
  })

  it('is "still" only after 3 s without vibration or rotation', () => {
    const e = createMotionEstimator()
    feed(e, 0, 2000, () => ({ accG: up, rot: { x: 0, y: 0, z: 0 } }))
    expect(e.state(2000).still).toBe(false)
    feed(e, 2000, 1500, () => ({ accG: up, rot: { x: 0, y: 0, z: 0 } }))
    expect(e.state(3500).still).toBe(true)
  })

  it('driving vibration is not "still"', () => {
    const e = createMotionEstimator()
    feed(e, 0, 4000, (t) => ({ accG: { x: Math.sin(t / 7) * 0.8, y: 9.8 + Math.cos(t / 5) * 0.8, z: 0 }, rot: { x: 0, y: 0, z: 0 } }))
    expect(e.state(4000).still).toBe(false)
  })

  it('reports "no sensor" when samples stop or are invalid', () => {
    const e = createMotionEstimator()
    expect(e.state(0)).toEqual({ turnRate: null, still: false })
    feed(e, 0, 500, () => ({ accG: up, rot: { x: 0, y: 0, z: 0 } }))
    expect(e.state(3000).turnRate).toBeNull()
    e.add({ t: 3100, accG: { x: Number.NaN, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } })
    expect(e.state(3100).turnRate).toBeNull()
  })
})
