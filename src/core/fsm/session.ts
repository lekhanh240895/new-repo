import { DEFAULT_CONFIG, type Config } from '../config.ts'
import { BLIND_SENSOR_STATES } from '../types.ts'
import { acknowledgeAwake, createMonitoringState, resetTimers, stepMonitoring } from './monitoring.ts'
import type {
  Effect,
  Phase,
  RunningPhase,
  SessionEvent,
  SessionState,
  Transition,
} from './types.ts'

const RUNNING_PHASES: ReadonlySet<Phase> = new Set<RunningPhase>([
  'PERMISSIONS',
  'LOADING',
  'SETUP_CHECK',
  'CALIBRATING',
  'MONITORING',
])

function isRunning(phase: Phase): phase is RunningPhase {
  return RUNNING_PHASES.has(phase)
}

export function createSession(): SessionState {
  return {
    phase: 'IDLE',
    resumeTo: null,
    fault: null,
    tripStartedAt: null,
    tripEndedAt: null,
    monitoring: createMonitoringState(),
  }
}

function ignore(state: SessionState, event: SessionEvent): Transition<SessionState> {
  // Frames arrive many times per second; ignoring them outside MONITORING is normal.
  if (event.type === 'FRAME') return { state, effects: [] }
  return { state, effects: [{ type: 'log', message: `ignored ${event.type} in ${state.phase}` }] }
}

function goTo(state: SessionState, phase: Phase, effects: Effect[] = []): Transition<SessionState> {
  return { state: { ...state, phase }, effects }
}

/** Resume a paused or faulted session. Monitoring timers start fresh. */
function resume(state: SessionState, to: RunningPhase, effects: Effect[]): Transition<SessionState> {
  return {
    state: {
      ...state,
      phase: to,
      resumeTo: null,
      fault: null,
      monitoring: to === 'MONITORING' ? resetTimers(state.monitoring) : state.monitoring,
    },
    effects,
  }
}

/**
 * The single entry point for all state changes (SPEC §13).
 * Pure: `(state, event) → { state, effects }`. Invalid events for the current
 * phase are ignored and logged, never thrown.
 */
export function reduce(
  state: SessionState,
  event: SessionEvent,
  cfg: Config = DEFAULT_CONFIG,
): Transition<SessionState> {
  const { phase } = state
  const alarmActive = state.monitoring.latched !== null

  switch (event.type) {
    case 'START':
      if (phase !== 'IDLE') return ignore(state, event)
      // The platform must run these inside the tap handler (user gesture),
      // or the browser blocks audio and camera.
      return {
        state: { ...createSession(), phase: 'PERMISSIONS', tripStartedAt: event.t },
        effects: [{ type: 'unlockAudio' }, { type: 'requestWakeLock' }, { type: 'startCamera' }],
      }

    case 'PERMISSIONS_GRANTED':
      return phase === 'PERMISSIONS' ? goTo(state, 'LOADING') : ignore(state, event)

    case 'PERMISSIONS_DENIED':
      if (phase !== 'PERMISSIONS') return ignore(state, event)
      return {
        state: { ...state, phase: 'FAULT', fault: 'CAMERA_DENIED', resumeTo: null },
        effects: [{ type: 'stopCamera' }, { type: 'releaseWakeLock' }],
      }

    case 'MODEL_READY':
      return phase === 'LOADING' ? goTo(state, 'SETUP_CHECK') : ignore(state, event)

    case 'MODEL_FAILED':
      if (phase !== 'LOADING') return ignore(state, event)
      return {
        state: { ...state, phase: 'FAULT', fault: 'MODEL_FAILED', resumeTo: 'LOADING' },
        effects: [{ type: 'log', message: 'model failed to load' }],
      }

    case 'SETUP_PASSED':
      return phase === 'SETUP_CHECK' ? goTo(state, 'CALIBRATING') : ignore(state, event)

    case 'SETUP_FAILED':
      if (phase !== 'SETUP_CHECK') return ignore(state, event)
      return {
        state: { ...state, phase: 'FAULT', fault: 'SETUP_FAILED', resumeTo: 'SETUP_CHECK' },
        effects: [],
      }

    case 'CALIBRATION_DONE':
      if (phase !== 'CALIBRATING') return ignore(state, event)
      return {
        state: { ...state, phase: 'MONITORING', monitoring: resetTimers(state.monitoring) },
        effects: [],
      }

    case 'FRAME': {
      if (phase !== 'MONITORING') return ignore(state, event)
      const next = stepMonitoring(state.monitoring, event.signals, cfg)
      if (next.state === state.monitoring) return { state, effects: next.effects }
      return { state: { ...state, monitoring: next.state }, effects: next.effects }
    }

    case 'ACK_AWAKE': {
      if (phase !== 'MONITORING') return ignore(state, event)
      const next = acknowledgeAwake(state.monitoring, event.t, cfg)
      if (next.state === state.monitoring) return { state, effects: next.effects }
      return { state: { ...state, monitoring: next.state }, effects: next.effects }
    }

    case 'PAGE_HIDDEN': {
      if (!isRunning(phase)) return ignore(state, event)
      const effects: Effect[] = []
      if (alarmActive) effects.push({ type: 'alarmStop' })
      if (phase === 'MONITORING') effects.push({ type: 'chime', kind: 'paused' })
      return {
        state: {
          ...state,
          phase: 'SUSPENDED',
          resumeTo: phase,
          monitoring: resetTimers(state.monitoring),
        },
        effects,
      }
    }

    case 'PAGE_VISIBLE':
      if (phase !== 'SUSPENDED' || state.resumeTo === null) return ignore(state, event)
      // Browsers drop the Wake Lock when the page is hidden.
      return resume(state, state.resumeTo, [{ type: 'requestWakeLock' }])

    case 'FAULT': {
      if (!isRunning(phase) && phase !== 'SUSPENDED') return ignore(state, event)
      const effects: Effect[] = [{ type: 'log', message: `fault: ${event.reason}` }]
      if (alarmActive) effects.push({ type: 'alarmStop' })
      const wasMonitoring = phase === 'MONITORING' || state.resumeTo === 'MONITORING'
      if (wasMonitoring) effects.push({ type: 'chime', kind: 'monitoringOff' })
      const resumeTo = event.reason === 'CAMERA_DENIED' ? null : isRunning(phase) ? phase : state.resumeTo
      return {
        state: {
          ...state,
          phase: 'FAULT',
          fault: event.reason,
          resumeTo,
          monitoring: resetTimers(state.monitoring),
        },
        effects,
      }
    }

    case 'RECOVERED':
      if (phase !== 'FAULT' || state.resumeTo === null) return ignore(state, event)
      return resume(state, state.resumeTo, [{ type: 'log', message: `recovered from ${state.fault}` }])

    case 'END_TRIP': {
      if (phase === 'IDLE' || phase === 'SUMMARY') return ignore(state, event)
      const effects: Effect[] = []
      if (alarmActive) effects.push({ type: 'alarmStop' })
      effects.push({ type: 'stopCamera' }, { type: 'releaseWakeLock' })
      return {
        state: { ...state, phase: 'SUMMARY', resumeTo: null, tripEndedAt: event.t },
        effects,
      }
    }

    case 'RESET': {
      if (phase === 'IDLE') return { state, effects: [] }
      if (phase === 'SUMMARY') return { state: createSession(), effects: [] }
      if (phase === 'FAULT') {
        return {
          state: createSession(),
          effects: [{ type: 'stopCamera' }, { type: 'releaseWakeLock' }],
        }
      }
      return ignore(state, event)
    }
  }
}

/** What the small HUD dot should show (SPEC §16). */
export type HudStatus = 'ok' | 'limited' | 'advisory' | 'off' | 'alarm'

export function hudStatus(state: SessionState): HudStatus {
  if (state.phase !== 'MONITORING') return 'off'
  const m = state.monitoring
  if (m.latched !== null) return 'alarm'
  if (BLIND_SENSOR_STATES.has(m.sensor)) return 'off'
  if (m.alert === 'ADVISORY' || m.alert === 'STRONG_ADVISORY') return 'advisory'
  if (m.sensor === 'EYES_HIDDEN' || m.sensor === 'DEGRADED') return 'limited'
  return 'ok'
}
