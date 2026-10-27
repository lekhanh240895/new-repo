import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.ts'
import { createBlinkTrend } from './blinkTrend.ts'

const cfg = DEFAULT_CONFIG.blinkTrend

/** One blink of `ms` every 4 s from `from` for `minutes`. */
function blinks(trend: ReturnType<typeof createBlinkTrend>, from: number, minutes: number, ms: number): number {
  let t = from
  for (; t < from + minutes * 60_000; t += 4000) trend.add(t, ms)
  return t
}

describe('blink length trend (E10)', () => {
  it('learns the normal blink length in the first minutes', () => {
    const b = createBlinkTrend(cfg)
    expect(b.normalMs()).toBeNull()
    blinks(b, 0, 5, 150)
    expect(b.normalMs()).toBe(150)
  })

  it('warns when blinks get twice as long', () => {
    const b = createBlinkTrend(cfg)
    let t = blinks(b, 0, 10, 150)
    expect(b.tired(t)).toBe(false)
    t = blinks(b, t, 3, 350)
    expect(b.tired(t)).toBe(true)
  })

  it('stays quiet for a small change (250 ms after 150 ms)', () => {
    const b = createBlinkTrend(cfg)
    const t = blinks(b, blinks(b, 0, 10, 150), 5, 250)
    expect(b.tired(t)).toBe(false)
  })

  it('never warns while still learning, or with too few recent blinks', () => {
    const b = createBlinkTrend(cfg)
    blinks(b, 0, 4, 150)
    expect(b.tired(4 * 60_000)).toBe(false)
    const c = createBlinkTrend(cfg)
    const t = blinks(c, 0, 6, 150)
    c.add(t + 60_000, 500)
    expect(c.tired(t + 60_000)).toBe(false)
  })
})
