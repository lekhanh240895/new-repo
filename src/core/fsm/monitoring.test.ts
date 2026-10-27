import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.ts'
import { effectNames, firstTimeOf, FRAME_MS, monitoringSession, repeat, runTrace } from '../../test/trace.ts'
import { reduce } from './session.ts'

const OPEN = { ms: 2000 }
const closed = (ms: number) => ({ ms, with: { eyesClosed: true } })
const away = (ms: number) => ({ ms, with: { offRoad: true } })
const ahead = (ms: number) => ({ ms })
/** Within one frame (rounded to whole ms) of the expected time. */
const near = (actual: number | undefined, expected: number) => {
  expect(actual).toBeDefined()
  expect(Math.abs((actual ?? Infinity) - expected)).toBeLessThanOrEqual(Math.ceil(FRAME_MS))
}

describe('microsleep (SPEC §10.1)', () => {
  it('ignores normal blinks', () => {
    const r = runTrace(repeat(20, [closed(200), ahead(2800)]))
    expect(effectNames(r.effects)).toEqual([])
    expect(r.state.monitoring.alert).toBe('NONE')
  })

  it('ignores slow blinks under 1 s', () => {
    const r = runTrace(repeat(5, [closed(900), ahead(3000)]))
    expect(effectNames(r.effects)).toEqual([])
  })

  it('raises L1 at 1.0 s and stops after 2 s of recovery', () => {
    const r = runTrace([OPEN, closed(1200), ahead(3000)])
    expect(effectNames(r.effects)).toEqual(['alarm:L1', 'alarmStop'])
    near(firstTimeOf(r, 'alarm:L1'), 2000 + 1000)
    near(firstTimeOf(r, 'alarmStop'), 2000 + 1200 + 2000)
  })

  it('escalates L1 → L2 → L3 and asks for a break after recovery', () => {
    const r = runTrace([OPEN, closed(2500), ahead(3000)])
    expect(effectNames(r.effects)).toEqual([
      'alarm:L1',
      'alarm:L2',
      'alarm:L3',
      'alarmStop',
      'speak:takeBreak',
    ])
    near(firstTimeOf(r, 'alarm:L2'), 2000 + 1500)
    near(firstTimeOf(r, 'alarm:L3'), 2000 + 2000)
    expect(r.state.monitoring.stats.alarms).toMatchObject({ L1: 1, L2: 1, L3: 1 })
  })

  it('keeps fatigue at ADVISORY after an L2+ alarm', () => {
    const r = runTrace([OPEN, closed(1600), ahead(3000)])
    expect(r.state.monitoring.alert).toBe('ADVISORY')
  })

  it('needs 2 s of continuous recovery; a blink restarts the count', () => {
    const r = runTrace([OPEN, closed(1100), ahead(1500), closed(200), ahead(1900), ahead(200)])
    const stop = firstTimeOf(r, 'alarmStop')
    // Recovery starts again after the blink at 2000+1100+1500+200.
    near(stop, 2000 + 1100 + 1500 + 200 + 2000)
  })

  it('does not drop the alarm when eyes open but the head stays down', () => {
    const r = runTrace([OPEN, closed(1100), { ms: 5000, with: { recovered: false } }])
    expect(effectNames(r.effects)).toEqual(['alarm:L1'])
    expect(r.state.monitoring.latched).toBe('L1')
  })

  it('records the longest closure', () => {
    const r = runTrace([OPEN, closed(1300), ahead(3000)])
    expect(r.state.monitoring.stats.longestClosureMs).toBeGreaterThanOrEqual(1300 - 2 * FRAME_MS)
  })
})

describe('fail-safe when the face is lost (SPEC §10.5)', () => {
  it('keeps escalating when the driver slumps out of view mid-closure', () => {
    const r = runTrace([OPEN, closed(600), { ms: 3000, with: { sensor: 'NO_FACE', eyesClosed: null, offRoad: null } }])
    expect(effectNames(r.effects)).toEqual(['alarm:L1', 'alarm:L2', 'alarm:L3'])
  })

  it('keeps an active alarm running when the face is lost', () => {
    const r = runTrace([OPEN, closed(1100), { ms: 3000, with: { sensor: 'NO_FACE', eyesClosed: null, offRoad: null } }])
    expect(r.state.monitoring.latched).toBe('L3')
  })

  it('does not alarm when a hand covers the face right after a normal blink', () => {
    const r = runTrace([OPEN, closed(150), { ms: 1400, with: { sensor: 'OCCLUDED', eyesClosed: null, offRoad: null } }, ahead(2000)])
    expect(effectNames(r.effects)).toEqual([])
  })

  it('plays "monitoring off" after 10 s blind, then every 60 s', () => {
    const r = runTrace([OPEN, { ms: 75_000, with: { sensor: 'LOW_VISIBILITY', eyesClosed: null, offRoad: null } }])
    expect(effectNames(r.effects)).toEqual(['chime:monitoringOff', 'chime:monitoringOff'])
    near(r.effects[0]?.t, 2000 + 10_000)
    near(r.effects[1]?.t, 2000 + 70_000)
  })

  it('resets the blind timer when the face comes back', () => {
    const blind = { ms: 8000, with: { sensor: 'NO_FACE' as const, eyesClosed: null, offRoad: null } }
    const r = runTrace([OPEN, blind, ahead(500), blind])
    expect(effectNames(r.effects)).toEqual([])
  })
})

describe('eyes off road (SPEC §10.3)', () => {
  it('ignores a mirror check under 2 s', () => {
    const r = runTrace(repeat(3, [away(1500), ahead(10_000)]))
    expect(effectNames(r.effects)).toEqual([])
  })

  it('raises D1 at 2 s and D2 at 3.5 s', () => {
    const r = runTrace([OPEN, away(4000), ahead(3000)])
    expect(effectNames(r.effects)).toEqual(['alarm:D1', 'alarm:D2', 'alarmStop'])
    near(firstTimeOf(r, 'alarm:D1'), 2000 + 2000)
    near(firstTimeOf(r, 'alarm:D2'), 2000 + 3500)
  })

  it('raises D2 when short glances add up to more than 6 s in 30 s', () => {
    const r = runTrace([OPEN, ...repeat(4, [away(1800), ahead(1000)])])
    expect(effectNames(r.effects)).toContain('alarm:D2')
    expect(effectNames(r.effects)).not.toContain('alarm:D1')
  })

  it('keeps counting off-road time when the head turns out of view', () => {
    const r = runTrace([OPEN, away(1000), { ms: 3000, with: { sensor: 'NO_FACE', eyesClosed: null, offRoad: null } }])
    expect(effectNames(r.effects)).toEqual(['alarm:D1', 'alarm:D2'])
  })

  it('lets microsleep override a distraction alarm', () => {
    const r = runTrace([OPEN, away(2200), closed(1600)])
    expect(effectNames(r.effects)).toEqual(['alarm:D1', 'alarm:L1', 'alarm:L2'])
  })
})

describe('degraded mode: sunglasses (SPEC §10.4)', () => {
  const hidden = { sensor: 'EYES_HIDDEN' as const, eyesClosed: null }

  it('announces limited monitoring once', () => {
    const r = runTrace([OPEN, { ms: 5000, with: hidden }, { ms: 5000, with: hidden }])
    expect(effectNames(r.effects)).toEqual(['speak:eyesHidden'])
  })

  it('uses head drop instead of eyes, capped at L2', () => {
    const r = runTrace([
      { ms: 1000, with: hidden },
      { ms: 3000, with: { ...hidden, headDropped: true, recovered: false } },
    ])
    expect(effectNames(r.effects)).toEqual(['speak:eyesHidden', 'alarm:L1', 'alarm:L2'])
  })
})

describe('fatigue (SPEC §10.2, §11)', () => {
  it('speaks the advisory at most once per 10 minutes', () => {
    const r = runTrace([{ ms: 11 * 60_000, with: { fatigue: 'ADVISORY' } }])
    expect(effectNames(r.effects)).toEqual(['speak:fatigueAdvisory', 'speak:fatigueAdvisory'])
    expect(r.state.monitoring.alert).toBe('ADVISORY')
  })

  it('STRONG fatigue lowers microsleep thresholds by 0.2 s', () => {
    const r = runTrace([{ ms: 2000, with: { fatigue: 'STRONG' } }, closed(900)])
    expect(effectNames(r.effects)).toEqual(['speak:fatigueStrong', 'alarm:L1'])
    near(firstTimeOf(r, 'alarm:L1'), 2000 + 800)
  })

  it('does not speak advisories during an alarm', () => {
    const r = runTrace([OPEN, closed(1100), { ms: 1000, with: { fatigue: 'ADVISORY', recovered: false } }])
    expect(effectNames(r.effects)).toEqual(['alarm:L1'])
  })
})

describe('speed arming (SPEC §10.6)', () => {
  it('does not alarm while the car is stopped; resting eyes ≥ 2 s give one advisory (C08)', () => {
    const r = runTrace([{ ms: 3000, with: { eyesClosed: true, armed: false } }, { ms: 3000, with: { offRoad: true, armed: false } }])
    expect(effectNames(r.effects)).toEqual(['speak:fatigueAdvisory'])
  })
})

describe('input safety', () => {
  it('ignores frames with bad or backward timestamps', () => {
    let s = monitoringSession()
    const frame = (t: number) =>
      ({ type: 'FRAME', signals: { t, sensor: 'OK', eyesClosed: false, headDropped: null, offRoad: false, recovered: true, fatigue: 'NONE', armed: true } }) as const
    s = reduce(s, frame(1000)).state
    for (const bad of [500, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = reduce(s, frame(bad))
      expect(r.state).toBe(s)
      expect(r.effects).toEqual([{ type: 'log', message: `ignored frame with bad timestamp: ${bad}` }])
    }
  })

  it('accepts a custom config', () => {
    const cfg = { ...DEFAULT_CONFIG, microsleep: { ...DEFAULT_CONFIG.microsleep, l1Ms: 500 } }
    const r = runTrace([OPEN, closed(600)], { cfg })
    expect(effectNames(r.effects)).toEqual(['alarm:L1'])
  })
})

describe('P2: per-zone budgets and split arming', () => {
  it('uses the budget the detectors give for the current zone', () => {
    const r = runTrace([{ ms: 2000 }, { ms: 2800, with: { offRoad: true, offRoadD1Ms: 2500, offRoadD2Ms: 4000 } }, { ms: 3000 }])
    expect(effectNames(r.effects)).toEqual(['alarm:D1', 'alarmStop'])
    near(firstTimeOf(r, 'alarm:D1'), 2000 + 2500)
  })

  it('driving looks do not add to the 30 s total', () => {
    const glances = Array.from({ length: 8 }, () => [{ ms: 1500, with: { offRoad: true, countsTowardShare: false } }, { ms: 1000 }]).flat()
    expect(effectNames(runTrace([{ ms: 1000 }, ...glances]).effects)).toEqual([])
  })

  it('distraction off but microsleep on (creeping in a jam)', () => {
    const r = runTrace([{ ms: 1000 }, { ms: 3000, with: { offRoad: true, armedD: false, armedL: true } }, { ms: 1700, with: { eyesClosed: true, armedD: false, armedL: true } }])
    expect(effectNames(r.effects)).toEqual(['alarm:L1', 'alarm:L2'])
  })

  it('one noisy "open" frame does not restart a closure (D05)', () => {
    const r = runTrace([{ ms: 2000 }, closed(600), { ms: 67, with: { eyesClosed: false, recovered: false } }, closed(800)])
    near(firstTimeOf(r, 'alarm:L1'), 2000 + 1000)
  })

  it('a real reopening (≥ 150 ms) does restart it', () => {
    const r = runTrace([{ ms: 2000 }, closed(600), { ms: 300, with: { eyesClosed: false, recovered: false } }, closed(800)])
    expect(effectNames(r.effects)).toEqual([])
  })
})

