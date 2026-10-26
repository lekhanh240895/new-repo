import { describe, expect, it } from 'vitest'
import { ALARM_PATTERNS, SPOKEN_TEXT } from './audio.ts'
import { isArmed } from './speed.ts'
import { createWatchdog } from './watchdog.ts'

describe('watchdog (SPEC §12 F20)', () => {
  it('reports a stall once, after stallMs without frames', () => {
    const w = createWatchdog(1000)
    w.arm(0)
    w.kick(0)
    expect(w.check(900)).toBe(false)
    expect(w.check(1000)).toBe(true)
    expect(w.check(1500)).toBe(false) // only once per stall
    w.kick(1600)
    expect(w.check(2700)).toBe(true)
  })

  it('does nothing until armed', () => {
    expect(createWatchdog(1000).check(5000)).toBe(false)
  })

  it('gives the first frame a longer start-up limit (GPU warm-up)', () => {
    const w = createWatchdog(1000, 10_000)
    w.arm(0)
    expect(w.check(3000)).toBe(false) // slow first frame is fine
    w.kick(3000)
    expect(w.check(4100)).toBe(true) // after that, the normal 1 s rule
  })

  it('still catches an engine that never produces a first frame', () => {
    const w = createWatchdog(1000, 10_000)
    w.arm(0)
    expect(w.check(10_000)).toBe(true)
  })
})

describe('speed arming (SPEC §10.6)', () => {
  it('is armed when moving or when speed is unknown', () => {
    expect(isArmed(null, 10)).toBe(true)
    expect(isArmed(50, 10)).toBe(true)
    expect(isArmed(3, 10)).toBe(false)
  })
})

describe('alarm sounds (SPEC §11)', () => {
  it('get louder and faster with each level', () => {
    const peak = (l: keyof typeof ALARM_PATTERNS) => Math.max(...ALARM_PATTERNS[l].tones.map((t) => t.toGain ?? t.gain))
    expect(peak('L1')).toBeLessThan(peak('L2'))
    expect(ALARM_PATTERNS.L3.cycle).toBeLessThan(ALARM_PATTERNS.L2.cycle)
    expect(ALARM_PATTERNS.L2.cycle).toBeLessThan(ALARM_PATTERNS.L1.cycle)
  })

  it('every tone fits inside its cycle (no overlap between repeats)', () => {
    for (const p of Object.values(ALARM_PATTERNS)) {
      for (const t of p.tones) expect(t.at + t.dur).toBeLessThanOrEqual(p.cycle)
    }
  })

  it('has text for every spoken message in every language', () => {
    const keys = Object.keys(SPOKEN_TEXT.en).sort()
    for (const table of Object.values(SPOKEN_TEXT)) {
      expect(Object.keys(table).sort()).toEqual(keys)
      for (const text of Object.values(table)) expect(text.length).toBeGreaterThan(0)
    }
  })
})
