import { describe, expect, it } from 'vitest'
import { createOneEuroFilter } from './oneEuro.ts'

/** Deterministic pseudo-random noise in −1..1. */
function noise(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return (s / 2147483648) * 2 - 1
  }
}

describe('One Euro filter', () => {
  it('returns the first value unchanged', () => {
    expect(createOneEuroFilter().filter(0.3, 0)).toBe(0.3)
  })

  it('reduces jitter on a still signal', () => {
    const f = createOneEuroFilter()
    const rand = noise(1)
    let rawVar = 0
    let outVar = 0
    for (let i = 0; i < 300; i++) {
      const raw = 0.3 + rand() * 0.02
      const out = f.filter(raw, i * 66)
      if (i > 30) {
        rawVar += (raw - 0.3) ** 2
        outVar += (out - 0.3) ** 2
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.25)
  })

  it('follows a real step change within a few frames (eye closing)', () => {
    const f = createOneEuroFilter({ minCutoff: 1, beta: 0.007, dCutoff: 1 })
    let t = 0
    for (let i = 0; i < 30; i++) f.filter(0.3, (t += 66))
    let out = 0.3
    for (let i = 0; i < 8; i++) out = f.filter(0.05, (t += 66))
    // Most of the way to "closed" after ~0.5 s, so 1 s+ closures are not hidden.
    expect(out).toBeLessThan(0.15)
  })

  it('ignores bad values and timestamps', () => {
    const f = createOneEuroFilter()
    f.filter(0.3, 0)
    const v = f.filter(0.31, 66)
    expect(f.filter(Number.NaN, 132)).toBe(v)
    expect(f.filter(0.9, 66)).toBe(v)
    expect(f.filter(0.9, Number.NaN)).toBe(v)
  })

  it('starts fresh after reset', () => {
    const f = createOneEuroFilter()
    f.filter(0.3, 0)
    f.reset()
    expect(f.filter(0.9, 10)).toBe(0.9)
  })

  it('rejects invalid params', () => {
    expect(() => createOneEuroFilter({ minCutoff: 0, beta: 0, dCutoff: 1 })).toThrow(RangeError)
  })
})
