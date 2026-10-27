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
    openSince: null,
    restClosedSince: null,
    offRoadSince: null,
    buffer: null,
    glanceStart: null,
    glanceZone: null,
    onRoadSince: null,
    emptySince: null,
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
  // Face lost right after a fast head drop counts as closed eyes (T15).
  const rawClosed = blind ? (s.assumeClosed ? true : null) : degraded ? s.headDropped : s.eyesClosed
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
  const armedD = s.armedD ?? s.armed
  const armedL = s.armedL ?? s.armed

  // Stopped: no microsleep alarms, but eyes closed for a long time still deserve an advisory (C08).
  const restClosedSince = !armedL && rawClosed === true ? (m.restClosedSince ?? t) : null
  const restingTooLong = restClosedSince !== null && t - restClosedSince >= cfg.microsleep.l3Ms
  if (!armedL) closedNow = false

  // A short "open" reading inside a closure (one noisy frame) does not restart the count (T6).
  let closedSince: number | null
  let openSince: number | null = null
  if (closedNow) {
    closedSince = m.closedSince ?? t
  } else if (m.closedSince !== null && armedL) {
    openSince = m.openSince ?? t
    closedSince = t - openSince < cfg.eye.closedGapMs ? m.closedSince : null
    if (closedSince === null) openSince = null
  } else {
    closedSince = null
  }
  let closureMs = closedNow && closedSince !== null ? t - closedSince : 0
  // Face lost mid-closure with no sign of a head drop (a hand rubbing the eyes, C07):
  // pause the count for a while. If the face stays away, count the paused time too.
  const blindStart = blind ? (m.blindSince ?? t) : null
  if (
    rawClosed === null &&
    blindStart !== null &&
    closedSince !== null &&
    !isMicrosleep(m.latched) &&
    t - blindStart < cfg.microsleep.blindGraceMs
  ) {
    closureMs = Math.min(closureMs, Math.max(0, blindStart - closedSince))
  }

  // A laugh, sneeze or yawn closes the eyes for a moment: wait a bit longer (T9).
  const extra = s.expression === true ? cfg.expression.extraMs : 0
  let micro: AlarmLevel | null = null
  if (closureMs >= cfg.microsleep.l3Ms - shift + extra) micro = 'L3'
  else if (closureMs >= cfg.microsleep.l2Ms - shift + extra) micro = 'L2'
  else if (closureMs >= cfg.microsleep.l1Ms - shift + extra) micro = 'L1'
  // Head drop alone is less certain than closed eyes: cap at L2.
  if (degraded && micro === 'L3') micro = 'L2'
  // Drowsy eyes that are not closed (heavy lids, sinking stare, repeated near-microsleeps): L1.
  const drowsy = armedL && !blind && s.drowsyEyes !== undefined
  if (drowsy && micro === null) micro = 'L1'

  // --- Eyes off road ---
  // Face lost right after a fast turn to the side counts as off road (T15).
  const rawOff = blind ? (s.assumeOffRoad ? true : null) : s.offRoad
  let offNow = rawOff === null ? m.offRoadSince !== null || isDistraction(m.latched) : rawOff
  if (!armedD) offNow = false

  // Each gaze zone has its own budget (T3); only phone-like looks add to the 30 s total.
  const d1Ms = s.offRoadD1Ms ?? cfg.offRoad.d1Ms
  const d2Ms = s.offRoadD2Ms ?? cfg.offRoad.d2Ms
  const countsTowardShare = s.countsTowardShare ?? true
  const offRoadSince = offNow ? (m.offRoadSince ?? t) : null
  const windowStart = t - cfg.offRoad.windowMs
  const offRoadLog = m.offRoadLog.filter((e) => e.t > windowStart)
  if (offNow && countsTowardShare && dt > 0) offRoadLog.push({ t, dt })
  const offTotalMs = offRoadLog.reduce((sum, e) => sum + e.dt, 0)

  // Attention buffer (T4). A zone budget above the capacity is a grace period before
  // draining; below it, a faster drain (0 = empty at once). Each new zone starts a new
  // glance with its own grace, so left-right scanning at slow speed is not punished (T5),
  // while lap/phone has no grace at all (guard B12).
  const att = cfg.attention
  let buffer = m.buffer ?? att.capacityMs
  let glanceStart: number | null = null
  let glanceZone: string | null = null
  let onRoadSince: number | null = null
  if (offNow) {
    const zoneKey = s.zone ?? m.glanceZone ?? 'unknown'
    const sameGlance = m.glanceStart !== null && (s.zone === undefined || zoneKey === m.glanceZone)
    glanceStart = sameGlance ? m.glanceStart : t
    glanceZone = zoneKey
    const grace = Math.max(0, d1Ms - att.capacityMs)
    if (d1Ms <= 0) {
      buffer = 0
    } else {
      const rate = d1Ms >= att.capacityMs ? 1 : att.capacityMs / d1Ms
      const draining = Math.max(0, Math.min(dt, t - (glanceStart ?? t) - grace))
      buffer = Math.max(0, buffer - draining * rate)
    }
  } else {
    onRoadSince = m.onRoadSince ?? t
    if (t - onRoadSince >= att.refillLatencyMs) buffer = Math.min(att.capacityMs, buffer + dt * att.refillRate)
  }
  const emptySince = offNow && buffer <= 0 ? (m.emptySince ?? t) : null

  let dist: AlarmLevel | null = null
  if (offNow && ((emptySince !== null && t - emptySince >= d2Ms - d1Ms) || (countsTowardShare && offTotalMs > cfg.offRoad.windowTotalMs))) {
    dist = 'D2'
  } else if (emptySince !== null) {
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
    const ok = s.recovered && !blind && !closedNow && !offNow && !drowsy
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
  if (
    restingTooLong &&
    latched === null &&
    speechEffects.length === 0 &&
    (lastAdvisorySpokenAt === null || t - lastAdvisorySpokenAt >= cfg.fatigue.advisoryRepeatMs)
  ) {
    speechEffects.push({ type: 'speak', message: 'fatigueAdvisory' })
    lastAdvisorySpokenAt = t
  }
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
      openSince,
      restClosedSince,
      offRoadSince,
      buffer,
      glanceStart,
      glanceZone,
      onRoadSince,
      emptySince,
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
