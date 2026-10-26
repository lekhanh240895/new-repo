import type { Config } from '../config.ts'
import { BLIND_SENSOR_STATES, type FatigueLevel, type FrameSignals } from '../types.ts'
import {
  ALERT_PRIORITY,
  type AlarmLevel,
  type AlertLevel,
  type Effect,
  type MonitoringState,
  type Transition,
} from './types.ts'

export function alertRank(level: AlertLevel | null): number {
  return level === null ? 0 : ALERT_PRIORITY.indexOf(level)
}

function maxAlarm(a: AlarmLevel | null, b: AlarmLevel | null): AlarmLevel | null {
  return alertRank(b) > alertRank(a) ? b : a
}

function isMicrosleep(level: AlarmLevel | null): boolean {
  return level === 'L1' || level === 'L2' || level === 'L3'
}

function isDistraction(level: AlarmLevel | null): boolean {
  return level === 'D1' || level === 'D2'
}

function advisoryFor(fatigue: FatigueLevel): AlertLevel {
  if (fatigue === 'STRONG') return 'STRONG_ADVISORY'
  if (fatigue === 'ADVISORY') return 'ADVISORY'
  return 'NONE'
}

export function createMonitoringState(): MonitoringState {
  return {
    lastT: null,
    sensor: 'OK',
    closedSince: null,
    offRoadSince: null,
    offRoadLog: [],
    recoveredSince: null,
    blindSince: null,
    lastMonitoringOffChimeAt: null,
    latched: null,
    alert: 'NONE',
    fatigue: 'NONE',
    strongShiftUntil: null,
    postAlarmAdvisoryUntil: null,
    lastAdvisorySpokenAt: null,
    lastStrongSpokenAt: null,
    stats: {
      alarms: { D1: 0, L1: 0, D2: 0, L2: 0, L3: 0 },
      longestClosureMs: 0,
    },
  }
}

/**
 * Clear all timers and the alarm latch, but keep trip stats and fatigue
 * history. Used when monitoring resumes after a pause or fault.
 */
export function resetTimers(m: MonitoringState): MonitoringState {
  const fresh = createMonitoringState()
  return {
    ...fresh,
    fatigue: m.fatigue,
    strongShiftUntil: m.strongShiftUntil,
    postAlarmAdvisoryUntil: m.postAlarmAdvisoryUntil,
    lastAdvisorySpokenAt: m.lastAdvisorySpokenAt,
    lastStrongSpokenAt: m.lastStrongSpokenAt,
    stats: m.stats,
  }
}

/** After an L2/L3 alarm ends, ask for a break and keep fatigue at ADVISORY for a while. */
function afterAlarmCleared(
  m: MonitoringState,
  cleared: AlarmLevel,
  t: number,
  cfg: Config,
): Pick<MonitoringState, 'postAlarmAdvisoryUntil' | 'lastAdvisorySpokenAt'> & { speak: boolean } {
  if (cleared === 'L2' || cleared === 'L3') {
    return {
      postAlarmAdvisoryUntil: t + cfg.fatigue.postAlarmAdvisoryMs,
      lastAdvisorySpokenAt: t,
      speak: true,
    }
  }
  return {
    postAlarmAdvisoryUntil: m.postAlarmAdvisoryUntil,
    lastAdvisorySpokenAt: m.lastAdvisorySpokenAt,
    speak: false,
  }
}

/**
 * One frame of the monitoring logic (SPEC §10, §11, §13).
 * Pure: same input, same output. Effects are returned, not run.
 */
export function stepMonitoring(
  m: MonitoringState,
  s: FrameSignals,
  cfg: Config,
): Transition<MonitoringState> {
  const { t } = s
  if (!Number.isFinite(t) || (m.lastT !== null && t < m.lastT)) {
    return { state: m, effects: [{ type: 'log', message: `ignored frame with bad timestamp: ${t}` }] }
  }

  const alarmEffects: Effect[] = []
  const speechEffects: Effect[] = []
  const dt = m.lastT === null ? 0 : Math.min(t - m.lastT, cfg.alert.maxFrameGapMs)
  const blind = BLIND_SENSOR_STATES.has(s.sensor)
  const degraded = s.sensor === 'EYES_HIDDEN'

  // STRONG fatigue makes microsleep rules more sensitive for a while.
  const strongShiftUntil =
    s.fatigue === 'STRONG' ? t + cfg.fatigue.strongShiftDurationMs : m.strongShiftUntil
  const shift =
    strongShiftUntil !== null && t < strongShiftUntil ? cfg.fatigue.strongThresholdShiftMs : 0

  // --- Eye closure (or head drop in degraded mode) ---
  const rawClosed = blind ? null : degraded ? s.headDropped : s.eyesClosed
  let closedNow: boolean
  if (rawClosed === null) {
    // Unknown this frame. Worst case wins (SPEC §10.5): if a microsleep alarm is
    // active, or the eyes were already closing, assume they are still closed.
    const closedFor = m.closedSince === null ? 0 : t - m.closedSince
    closedNow =
      isMicrosleep(m.latched) ||
      (m.closedSince !== null && closedFor >= cfg.microsleep.carryClosureMinMs)
  } else {
    closedNow = rawClosed
  }
  if (!s.armed) closedNow = false

  const closedSince = closedNow ? (m.closedSince ?? t) : null
  const closureMs = closedSince === null ? 0 : t - closedSince

  let micro: AlarmLevel | null = null
  if (closureMs >= cfg.microsleep.l3Ms - shift) micro = 'L3'
  else if (closureMs >= cfg.microsleep.l2Ms - shift) micro = 'L2'
  else if (closureMs >= cfg.microsleep.l1Ms - shift) micro = 'L1'
  // Head drop alone is less certain than closed eyes: cap at L2.
  if (degraded && micro === 'L3') micro = 'L2'

  // --- Eyes off road ---
  const rawOff = blind ? null : s.offRoad
  let offNow = rawOff === null ? m.offRoadSince !== null || isDistraction(m.latched) : rawOff
  if (!s.armed) offNow = false

  const offRoadSince = offNow ? (m.offRoadSince ?? t) : null
  const offContinuousMs = offRoadSince === null ? 0 : t - offRoadSince
  const windowStart = t - cfg.offRoad.windowMs
  const offRoadLog = m.offRoadLog.filter((e) => e.t > windowStart)
  if (offNow && dt > 0) offRoadLog.push({ t, dt })
  const offTotalMs = offRoadLog.reduce((sum, e) => sum + e.dt, 0)

  let dist: AlarmLevel | null = null
  if (offNow && (offContinuousMs >= cfg.offRoad.d2Ms || offTotalMs > cfg.offRoad.windowTotalMs)) {
    dist = 'D2'
  } else if (offContinuousMs >= cfg.offRoad.d1Ms) {
    dist = 'D1'
  }

  // --- Latch, escalate, recover ---
  let latched = maxAlarm(m.latched, maxAlarm(micro, dist))
  const alarms = { ...m.stats.alarms }
  if (latched !== null && alertRank(latched) > alertRank(m.latched)) alarms[latched] += 1

  let recoveredSince: number | null = null
  let postAlarmAdvisoryUntil = m.postAlarmAdvisoryUntil
  let lastAdvisorySpokenAt = m.lastAdvisorySpokenAt
  if (latched !== null) {
    const ok = s.recovered && !blind && !closedNow && !offNow
    recoveredSince = ok ? (m.recoveredSince ?? t) : null
    if (recoveredSince !== null && t - recoveredSince >= cfg.alert.recoveryMs) {
      const after = afterAlarmCleared(m, latched, t, cfg)
      postAlarmAdvisoryUntil = after.postAlarmAdvisoryUntil
      lastAdvisorySpokenAt = after.lastAdvisorySpokenAt
      if (after.speak) speechEffects.push({ type: 'speak', message: 'takeBreak' })
      latched = null
      recoveredSince = null
    }
  }

  if (latched !== m.latched) {
    alarmEffects.push(latched === null ? { type: 'alarmStop' } : { type: 'alarm', level: latched })
  }

  // --- Fatigue advisories (only when no alarm is active) ---
  let fatigue = s.fatigue
  if (fatigue === 'NONE' && postAlarmAdvisoryUntil !== null && t < postAlarmAdvisoryUntil) {
    fatigue = 'ADVISORY'
  }
  let lastStrongSpokenAt = m.lastStrongSpokenAt
  if (latched === null && speechEffects.length === 0) {
    if (
      fatigue === 'STRONG' &&
      (lastStrongSpokenAt === null || t - lastStrongSpokenAt >= cfg.fatigue.strongRepeatMs)
    ) {
      speechEffects.push({ type: 'speak', message: 'fatigueStrong' })
      lastStrongSpokenAt = t
    } else if (
      fatigue === 'ADVISORY' &&
      (lastAdvisorySpokenAt === null || t - lastAdvisorySpokenAt >= cfg.fatigue.advisoryRepeatMs)
    ) {
      speechEffects.push({ type: 'speak', message: 'fatigueAdvisory' })
      lastAdvisorySpokenAt = t
    }
  }

  if (degraded && m.sensor !== 'EYES_HIDDEN') {
    speechEffects.push({ type: 'speak', message: 'eyesHidden' })
  }

  // --- Fail loud when the driver can't be seen (SPEC §4) ---
  const blindSince = blind ? (m.blindSince ?? t) : null
  let lastMonitoringOffChimeAt = blind ? m.lastMonitoringOffChimeAt : null
  const chimeEffects: Effect[] = []
  if (
    blindSince !== null &&
    latched === null &&
    t - blindSince >= cfg.alert.monitoringOffAfterMs &&
    (lastMonitoringOffChimeAt === null ||
      t - lastMonitoringOffChimeAt >= cfg.alert.monitoringOffRepeatMs)
  ) {
    chimeEffects.push({ type: 'chime', kind: 'monitoringOff' })
    lastMonitoringOffChimeAt = t
  }

  return {
    state: {
      lastT: t,
      sensor: s.sensor,
      closedSince,
      offRoadSince,
      offRoadLog,
      recoveredSince,
      blindSince,
      lastMonitoringOffChimeAt,
      latched,
      alert: latched ?? advisoryFor(fatigue),
      fatigue,
      strongShiftUntil,
      postAlarmAdvisoryUntil,
      lastAdvisorySpokenAt,
      lastStrongSpokenAt,
      stats: {
        alarms,
        longestClosureMs: Math.max(m.stats.longestClosureMs, closureMs),
      },
    },
    effects: [...alarmEffects, ...speechEffects, ...chimeEffects],
  }
}

/**
 * The driver tapped "I'm awake". Allowed, never required (SPEC §11).
 * Timers are kept, so if the eyes are still closed the alarm comes back on the next frame.
 */
export function acknowledgeAwake(
  m: MonitoringState,
  t: number,
  cfg: Config,
): Transition<MonitoringState> {
  if (m.latched === null) return { state: m, effects: [] }
  const after = afterAlarmCleared(m, m.latched, t, cfg)
  const effects: Effect[] = [{ type: 'alarmStop' }]
  if (after.speak) effects.push({ type: 'speak', message: 'takeBreak' })
  return {
    state: {
      ...m,
      latched: null,
      recoveredSince: null,
      alert: advisoryFor(m.fatigue),
      postAlarmAdvisoryUntil: after.postAlarmAdvisoryUntil,
      lastAdvisorySpokenAt: after.lastAdvisorySpokenAt,
    },
    effects,
  }
}
