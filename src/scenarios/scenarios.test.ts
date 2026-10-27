/**
 * Ratchet over the alert-accuracy scenarios (docs/ALERT_ACCURACY_PLAN.md):
 * a scenario that passed in the recorded baseline must keep passing.
 * New passes are reported; record them with `npm run scenarios -- --update-baseline`.
 */
import { describe, expect, it } from 'vitest'
import { BASELINE as baseline } from './baseline.ts'
import { road, seg } from './looks.ts'
import { runScenario, SCENARIOS } from './index.ts'

describe('scenario library', () => {
  it('has unique IDs, all in the baseline', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(baseline).sort()).toEqual([...ids].sort())
  })

  it('every runnable scenario states what should happen', () => {
    for (const s of SCENARIOS) {
      if (s.clipOnly !== undefined || s.check) continue
      expect(s.expect?.length ?? 0, s.id).toBeGreaterThan(0)
      expect(s.segments?.length ?? 0, s.id).toBeGreaterThan(0)
    }
  })
})

describe('scenario runner', () => {
  it('reports an alarm that arrives in time', () => {
    const r = runScenario({
      id: 'T1', title: 'eyes closed 2.5 s', testType: 'S', fixes: [],
      segments: [road(2000), seg(2500, { ear: 0.05, blink: 0.95 }, undefined, 'x'), road(3000)],
      expect: [{ kind: 'alarm', family: 'L', after: 'x', within: 1200 }, { kind: 'stops', after: 'x', within: 6000 }],
    })
    expect(r.status).toBe('pass')
  })

  it('explains a broken expectation', () => {
    const r = runScenario({
      id: 'T2', title: 'look away 3 s', testType: 'S', fixes: [],
      segments: [road(2000), seg(3000, { yaw: 50 }), road(3000)],
      expect: [{ kind: 'noAlarm', family: 'D' }],
    })
    expect(r.status).toBe('fail')
    expect(r.reasons[0]).toMatch(/unexpected D1/)
  })

  it('does not run clip-only scenarios', () => {
    expect(runScenario({ id: 'T3', title: 'x', testType: 'R', fixes: [], clipOnly: 'needs a clip' }).status).toBe('clip')
  })
})

describe('no regressions against the baseline', () => {
  const improved: string[] = []
  for (const s of SCENARIOS) {
    if (baseline[s.id] !== 'pass') continue
    it(`${s.id} still passes — ${s.title}`, () => {
      const r = runScenario(s)
      expect(r.reasons, `${s.id} regressed`).toEqual([])
      expect(r.status).toBe('pass')
    })
  }
  it('lists newly passing scenarios (update the baseline to lock them in)', () => {
    for (const s of SCENARIOS) {
      if (baseline[s.id] === 'fail' && runScenario(s).status === 'pass') improved.push(s.id)
    }
    if (improved.length > 0) console.info(`Newly passing: ${improved.join(', ')} — run "npm run scenarios -- --update-baseline"`)
    expect(true).toBe(true)
  })
})
