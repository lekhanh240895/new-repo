import { describe, expect, it } from 'vitest'
import { isMustAlarm, runLibrary } from '../scenarios/tuning.ts'
import { SCENARIOS } from '../scenarios/index.ts'
import { DEFAULT_CONFIG } from './config.ts'
import { atLimit, DEFAULT_PERSONAL, markFalseAlarm, parsePersonal, personalize, scaleFor, type Personal } from './personal.ts'

const maxed = (): Personal => {
  let p: Personal = { ...DEFAULT_PERSONAL }
  for (let i = 0; i < 10; i++) p = markFalseAlarm(markFalseAlarm(p, 'D'), 'L')
  return p
}

describe('personal adaptation (T12)', () => {
  it('each "false alarm" mark loosens its family by 5%, up to +10%', () => {
    let p: Personal = { ...DEFAULT_PERSONAL }
    p = markFalseAlarm(p, 'D')
    expect(scaleFor(p, 'D')).toBeCloseTo(1.05)
    expect(scaleFor(p, 'L')).toBe(1)
    expect(scaleFor(maxed(), 'D')).toBeCloseTo(1.1)
    expect(scaleFor(maxed(), 'L')).toBeCloseTo(1.1)
    expect(atLimit(maxed(), 'D')).toBe(true)
  })

  it('no marks: the config is unchanged', () => {
    expect(personalize(DEFAULT_CONFIG, DEFAULT_PERSONAL)).toBe(DEFAULT_CONFIG)
  })

  it('never touches the safety floor: phone / lap / console budgets, L2, L3', () => {
    const c = personalize(DEFAULT_CONFIG, maxed())
    expect(c.budgets.lapMs).toBe(DEFAULT_CONFIG.budgets.lapMs)
    expect(c.budgets.consoleMs).toBe(DEFAULT_CONFIG.budgets.consoleMs)
    expect(c.microsleep.l2Ms).toBe(DEFAULT_CONFIG.microsleep.l2Ms)
    expect(c.microsleep.l3Ms).toBe(DEFAULT_CONFIG.microsleep.l3Ms)
    expect(c.microsleep.l1Ms).toBeLessThan(c.microsleep.l2Ms)
    expect(c.budgets.mirrorMs).toBeCloseTo(DEFAULT_CONFIG.budgets.mirrorMs * 1.1)
  })

  it('reads stored data defensively (old, corrupt or edited by hand)', () => {
    expect(parsePersonal(null)).toEqual(DEFAULT_PERSONAL)
    expect(parsePersonal('x')).toEqual(DEFAULT_PERSONAL)
    expect(parsePersonal({ version: 2, marksD: 1 })).toEqual(DEFAULT_PERSONAL)
    expect(parsePersonal({ version: 1, marksD: 99, marksL: -3 })).toEqual({ version: 1, marksD: 2, marksL: 0 })
    expect(parsePersonal({ version: 1, marksD: Number.NaN, marksL: 1.7 })).toEqual({ version: 1, marksD: 0, marksL: 1 })
  })

  it('at the limit, every must-alarm scenario still passes (safety floor)', () => {
    const must = SCENARIOS.filter((s) => isMustAlarm(s) && !s.id.startsWith('G'))
    expect(runLibrary(personalize(DEFAULT_CONFIG, maxed()), must).misses).toEqual([])
  })
})
