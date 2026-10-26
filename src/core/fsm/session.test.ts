import { describe, expect, it } from 'vitest'
import { monitoringSession, runTrace } from '../../test/trace.ts'
import { createSession, hudStatus, reduce } from './session.ts'
import type { SessionEvent, SessionState } from './types.ts'

function run(state: SessionState, events: readonly SessionEvent[]) {
  const effects = []
  for (const e of events) {
    const r = reduce(state, e)
    state = r.state
    effects.push(...r.effects)
  }
  return { state, effects }
}

describe('session phases (SPEC §13.1)', () => {
  it('walks the happy path from IDLE to SUMMARY', () => {
    const { state, effects } = run(createSession(), [
      { type: 'START', t: 0 },
      { type: 'PERMISSIONS_GRANTED', t: 10 },
      { type: 'MODEL_READY', t: 20 },
      { type: 'SETUP_PASSED', t: 30 },
      { type: 'CALIBRATION_DONE', t: 40 },
      { type: 'END_TRIP', t: 50 },
    ])
    expect(state.phase).toBe('SUMMARY')
    expect(state.tripStartedAt).toBe(0)
    expect(state.tripEndedAt).toBe(50)
    expect(effects.map((e) => e.type)).toEqual([
      'unlockAudio',
      'requestWakeLock',
      'startCamera',
      'stopCamera',
      'releaseWakeLock',
    ])
  })

  it('goes to FAULT when the camera is denied, and RESET returns to IDLE', () => {
    let { state } = run(createSession(), [
      { type: 'START', t: 0 },
      { type: 'PERMISSIONS_DENIED', t: 1 },
    ])
    expect(state).toMatchObject({ phase: 'FAULT', fault: 'CAMERA_DENIED', resumeTo: null })
    // Camera denied cannot recover by itself.
    state = reduce(state, { type: 'RECOVERED', t: 2 }).state
    expect(state.phase).toBe('FAULT')
    state = reduce(state, { type: 'RESET', t: 3 }).state
    expect(state).toEqual(createSession())
  })

  it('can retry after a model load failure', () => {
    const { state } = run(createSession(), [
      { type: 'START', t: 0 },
      { type: 'PERMISSIONS_GRANTED', t: 1 },
      { type: 'MODEL_FAILED', t: 2 },
      { type: 'RECOVERED', t: 3 },
    ])
    expect(state).toMatchObject({ phase: 'LOADING', fault: null })
  })

  it('ignores events that do not fit the phase, without throwing', () => {
    const s = createSession()
    const r = reduce(s, { type: 'CALIBRATION_DONE', t: 0 })
    expect(r.state).toBe(s)
    expect(r.effects).toEqual([{ type: 'log', message: 'ignored CALIBRATION_DONE in IDLE' }])
  })

  it('ignores frames silently outside MONITORING', () => {
    const s = createSession()
    const r = reduce(s, {
      type: 'FRAME',
      signals: { t: 0, sensor: 'OK', eyesClosed: true, headDropped: null, offRoad: false, recovered: false, fatigue: 'NONE', armed: true },
    })
    expect(r).toEqual({ state: s, effects: [] })
  })
})

describe('page visibility (SPEC §12 F7, F10)', () => {
  it('pauses with a chime, stops an active alarm, and resumes with fresh timers', () => {
    const alarming = runTrace([{ ms: 1200, with: { eyesClosed: true } }]).state
    expect(alarming.monitoring.latched).toBe('L1')

    const hidden = reduce(alarming, { type: 'PAGE_HIDDEN', t: 1300 })
    expect(hidden.state).toMatchObject({ phase: 'SUSPENDED', resumeTo: 'MONITORING' })
    expect(hidden.effects).toEqual([{ type: 'alarmStop' }, { type: 'chime', kind: 'paused' }])

    const visible = reduce(hidden.state, { type: 'PAGE_VISIBLE', t: 5000 })
    expect(visible.state.phase).toBe('MONITORING')
    expect(visible.state.monitoring.latched).toBeNull()
    expect(visible.state.monitoring.closedSince).toBeNull()
    expect(visible.state.monitoring.stats.alarms.L1).toBe(1)
    expect(visible.effects).toEqual([{ type: 'requestWakeLock' }])
  })

  it('resumes setup phases where they left off', () => {
    let { state } = run(createSession(), [
      { type: 'START', t: 0 },
      { type: 'PERMISSIONS_GRANTED', t: 1 },
      { type: 'PAGE_HIDDEN', t: 2 },
    ])
    expect(state.phase).toBe('SUSPENDED')
    state = reduce(state, { type: 'PAGE_VISIBLE', t: 3 }).state
    expect(state.phase).toBe('LOADING')
  })
})

describe('faults during monitoring (SPEC §12 F19, F20)', () => {
  it('chimes "monitoring off" and resumes monitoring on recovery', () => {
    const s = monitoringSession()
    const fault = reduce(s, { type: 'FAULT', t: 100, reason: 'WORKER_STALLED' })
    expect(fault.state).toMatchObject({ phase: 'FAULT', fault: 'WORKER_STALLED', resumeTo: 'MONITORING' })
    expect(fault.effects).toContainEqual({ type: 'chime', kind: 'monitoringOff' })

    const back = reduce(fault.state, { type: 'RECOVERED', t: 200 })
    expect(back.state).toMatchObject({ phase: 'MONITORING', fault: null })
  })

  it('a fault while suspended keeps the resume target', () => {
    let s = monitoringSession()
    s = reduce(s, { type: 'PAGE_HIDDEN', t: 1 }).state
    s = reduce(s, { type: 'FAULT', t: 2, reason: 'CAMERA_LOST' }).state
    expect(s).toMatchObject({ phase: 'FAULT', resumeTo: 'MONITORING' })
  })

  it('END_TRIP works from FAULT and stops the camera', () => {
    let s = monitoringSession()
    s = reduce(s, { type: 'FAULT', t: 1, reason: 'CAMERA_LOST' }).state
    const r = reduce(s, { type: 'END_TRIP', t: 2 })
    expect(r.state.phase).toBe('SUMMARY')
    expect(r.effects.map((e) => e.type)).toEqual(['stopCamera', 'releaseWakeLock'])
  })
})

describe('manual "I\'m awake" (SPEC §11)', () => {
  it('stops the alarm and asks for a break after L2+', () => {
    const s = runTrace([{ ms: 1600, with: { eyesClosed: true, recovered: false } }]).state
    const r = reduce(s, { type: 'ACK_AWAKE', t: 1700 })
    expect(r.effects).toEqual([{ type: 'alarmStop' }, { type: 'speak', message: 'takeBreak' }])
    expect(r.state.monitoring.latched).toBeNull()
  })

  it('does nothing without an alarm', () => {
    const s = monitoringSession()
    expect(reduce(s, { type: 'ACK_AWAKE', t: 1 }).effects).toEqual([])
  })
})

describe('HUD dot (SPEC §16)', () => {
  it('maps state to the dot colour', () => {
    expect(hudStatus(createSession())).toBe('off')
    expect(hudStatus(runTrace([{ ms: 500 }]).state)).toBe('ok')
    expect(hudStatus(runTrace([{ ms: 500, with: { sensor: 'EYES_HIDDEN', eyesClosed: null } }]).state)).toBe('limited')
    expect(hudStatus(runTrace([{ ms: 500, with: { fatigue: 'ADVISORY' } }]).state)).toBe('advisory')
    expect(hudStatus(runTrace([{ ms: 500, with: { sensor: 'NO_FACE', eyesClosed: null, offRoad: null } }]).state)).toBe('off')
    expect(hudStatus(runTrace([{ ms: 1200, with: { eyesClosed: true } }]).state)).toBe('alarm')
  })
})
