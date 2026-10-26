import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.ts'
import { createNodDetector } from './nod.ts'
import { createEventCounter, createPerclos } from './windows.ts'
import { createYawnDetector } from './yawn.ts'

const cfg = DEFAULT_CONFIG

/** Feed a value every 66 ms from `from` to `to`; returns how many times `fn` returned true. */
function feed(from: number, to: number, fn: (t: number) => boolean): number {
  let hits = 0
  for (let t = from; t < to; t += 66) if (fn(t)) hits++
  return hits
}

describe('event counter', () => {
  it('counts events inside the window only', () => {
    const c = createEventCounter(1000)
    c.add(0)
    c.add(500)
    expect(c.count(900)).toBe(2)
    expect(c.count(1200)).toBe(1)
  })
})

describe('PERCLOS (SPEC §10.2)', () => {
  const w = cfg.fatigue.perclosWindowMs

  it('is null until the window is (almost) full', () => {
    const p = createPerclos(w, 0.7)
    feed(0, 30_000, (t) => (p.add(t, false), false))
    expect(p.value(30_000)).toBeNull()
  })

  it('is the share of valid frames with closed eyes', () => {
    const p = createPerclos(w, 0.7)
    // Closed 1 frame in 5 → 20%.
    let i = 0
    feed(0, 61_000, (t) => (p.add(t, i++ % 5 === 0), false))
    expect(p.value(61_000)).toBeCloseTo(0.2, 1)
  })

  it('is null when too many frames were unknown', () => {
    const p = createPerclos(w, 0.7)
    let i = 0
    feed(0, 61_000, (t) => (p.add(t, i++ % 2 === 0 ? null : false), false))
    expect(p.value(61_000)).toBeNull()
  })
})

describe('yawn detector (SPEC §10.2, F11)', () => {
  it('counts a wide mouth held ≥ 1.2 s, once', () => {
    const y = createYawnDetector(cfg.fatigue, cfg.mouth)
    feed(0, 2000, (t) => y.update(t, 0.05))
    expect(feed(2000, 5000, (t) => y.update(t, 0.8))).toBe(1)
  })

  it('ignores a short wide mouth (< 1.2 s)', () => {
    const y = createYawnDetector(cfg.fatigue, cfg.mouth)
    feed(0, 2000, (t) => y.update(t, 0.05))
    expect(feed(2000, 3000, (t) => y.update(t, 0.8))).toBe(0)
  })

  it('ignores singing: fast open/close cycles before a long open note', () => {
    const y = createYawnDetector(cfg.fatigue, cfg.mouth)
    // ~3 cycles per second (period ≈ 330 ms) like syllables.
    feed(0, 3000, (t) => y.update(t, Math.floor(t / 165) % 2 === 0 ? 0.1 : 0.5))
    expect(feed(3000, 5000, (t) => y.update(t, 0.8))).toBe(0)
  })

  it('resets when the mouth cannot be seen', () => {
    const y = createYawnDetector(cfg.fatigue, cfg.mouth)
    feed(0, 1000, (t) => y.update(t, 0.8))
    y.update(1000, null)
    expect(feed(1066, 2000, (t) => y.update(t, 0.8))).toBe(0)
  })
})

describe('nod detector (SPEC §10.2)', () => {
  it('counts a quick drop that comes back', () => {
    const n = createNodDetector(cfg.fatigue, cfg.pose)
    feed(0, 1000, (t) => n.update(t, 0))
    feed(1000, 1400, (t) => n.update(t, 20)) // dropped within 0.4 s
    expect(feed(1400, 2000, (t) => n.update(t, 0))).toBe(1)
  })

  it('ignores a slow lean forward', () => {
    const n = createNodDetector(cfg.fatigue, cfg.pose)
    feed(0, 1000, (t) => n.update(t, 0))
    // 0 → 20° over 2 s.
    feed(1000, 3000, (t) => n.update(t, ((t - 1000) / 2000) * 20))
    expect(feed(3000, 4000, (t) => n.update(t, 0))).toBe(0)
  })

  it('does not count a drop that never comes back', () => {
    const n = createNodDetector(cfg.fatigue, cfg.pose)
    feed(0, 1000, (t) => n.update(t, 0))
    feed(1000, 5000, (t) => n.update(t, 25))
    expect(feed(5000, 6000, (t) => n.update(t, 0))).toBe(0)
  })
})
