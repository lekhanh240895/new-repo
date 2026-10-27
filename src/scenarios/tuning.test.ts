import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../core/config.ts'
import { GROUPS } from './index.ts'
import { getPath, isMustAlarm, runLibrary, suggest, withValue, type Sweep } from './tuning.ts'

const G = GROUPS.G?.scenarios ?? []

describe('tuning helpers (T13)', () => {
  it('reads and changes one config value without touching the default', () => {
    const c = withValue(DEFAULT_CONFIG, 'budgets.lapMs', 1700)
    expect(getPath(c, 'budgets.lapMs')).toBe(1700)
    expect(DEFAULT_CONFIG.budgets.lapMs).toBe(2000)
    expect(() => getPath(DEFAULT_CONFIG, 'budgets.nope')).toThrow()
  })

  it('knows which cases must alarm', () => {
    expect(isMustAlarm(G.find((s) => s.id === 'G02')!)).toBe(true)
    expect(isMustAlarm(G.find((s) => s.id === 'G01')!)).toBe(false)
  })

  it('only suggests a change that fixes something and breaks nothing', () => {
    const s: Sweep = {
      path: 'budgets.lapMs', value: 2000, safeLow: 0.9, safeHigh: 1.1,
      points: [
        { factor: 0.9, value: 1800, broken: [], fixed: [], misses: [] },
        { factor: 1.1, value: 2200, broken: [], fixed: ['X1'], misses: [] },
        { factor: 1.2, value: 2400, broken: ['G02'], fixed: ['X1', 'X2'], misses: ['G02'] },
      ],
    }
    expect(suggest([s])).toEqual([{ path: 'budgets.lapMs', from: 2000, to: 2200, fixed: ['X1'] }])
  })
})

describe('boundary pairs catch a threshold moving 15% (P1 gap)', () => {
  const broken = (path: string, factor: number) =>
    [...runLibrary(withValue(DEFAULT_CONFIG, path, getPath(DEFAULT_CONFIG, path) * factor), G).failed]

  it('lap / phone budget', () => {
    expect(broken('budgets.lapMs', 0.85)).toContain('G01')
    expect(broken('budgets.lapMs', 1.15)).toContain('G02')
  })

  it('microsleep L1', () => {
    expect(broken('microsleep.l1Ms', 0.85)).toContain('G13')
    expect(broken('microsleep.l1Ms', 1.15)).toContain('G14')
  })
})
