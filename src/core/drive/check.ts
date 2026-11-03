/**
 * Drive check (plan P8): reads a drive log from a real drive and answers two
 * questions the desk tests cannot.
 *
 * 1. GPS: was there a speed most of the time, and did any alarm start while the
 *    car was stopped (decision 1: no alarms at a standstill)?
 * 2. Gyroscope: is the turn sign right? The GPS heading turns clockwise in a right
 *    turn, whatever way the phone is mounted, so each turn the gyroscope sees is
 *    compared with the heading change. Without heading, the head yaw is a weaker
 *    witness: drivers look into the turn.
 */
import { DEFAULT_CONFIG, type Config } from '../config.ts'
import type { AlarmLevel } from '../fsm/types.ts'
import type { DriveLogFile, DriveRow } from './log.ts'

export type GpsVerdict = 'ok' | 'weak' | 'noFix'
export type GyroVerdict = 'ok' | 'flip' | 'unclear' | 'notEnough' | 'noSensor'

export interface DriveTurn {
  atSec: number;
  durationSec: number;
  /** Mean gyroscope turn rate (°/s, > 0 = right by the logged sign). */
  turnRate: number;
  /** GPS heading change over the turn (° clockwise); null = no heading. */
  headingChange: number | null;
  /** Median head yaw during the turn (> 0 = right); null = face not seen. */
  headYaw: number | null;
}

export interface DriveReport {
  durationSec: number;
  truncated: boolean;
  gps: {
    verdict: GpsVerdict;
    /** Share of rows with a speed, 0–1. */
    fixRatio: number;
    maxKmh: number | null;
    movingSec: number;
    stoppedSec: number;
  };
  /** Alarm episodes in the log. */
  alarms: number;
  /** Alarms that started while stopped (should be none; moving off is not counted). */
  stoppedAlarms: { atSec: number; level: AlarmLevel }[];
  turns: DriveTurn[];
  gyro: {
    verdict: GyroVerdict;
    /** Which witness decided: the GPS heading (strong) or the head yaw (weaker). */
    source: 'heading' | 'head' | null;
    agree: number;
    disagree: number;
    currentSign: 1 | -1;
    /** The value `motion.turnRightSign` should have; null = cannot tell. */
    recommendedSign: 1 | -1 | null;
  };
}

/** A turn must last this long to count (one corner, not a lane change wobble). */
const MIN_TURN_SEC = 1.5
/** The heading must change at least this much for the turn to count as a witness. */
const MIN_HEADING_CHANGE_DEG = 15
/** The head must point at least this far into a side. */
const MIN_HEAD_YAW_DEG = 5
const MIN_HEADING_TURNS = 3
const MIN_HEAD_TURNS = 5
/** A "stopped" alarm followed by speed within this time is the moving-off alert, not a stopped one. */
const MOVE_OFF_SEC = 2
const GPS_OK_RATIO = 0.7
const GPS_NONE_RATIO = 0.05

/** Signed smallest difference between two headings (° clockwise, −180..180). */
export function headingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}

/** Heading change across rows [from, to], one row of margin on each side (the turn starts before the gyro threshold). */
function headingChange(rows: readonly DriveRow[], from: number, to: number): number | null {
  const hs = rows.slice(Math.max(0, from - 1), to + 2).flatMap((r) => (r.headingDeg === null ? [] : [r.headingDeg]))
  if (hs.length < 2) return null
  let total = 0
  for (let i = 1; i < hs.length; i++) total += headingDelta(hs[i - 1] ?? 0, hs[i] ?? 0)
  return total
}

function findTurns(rows: readonly DriveRow[], rowSec: number, cfg: Config): DriveTurn[] {
  const turns: DriveTurn[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    const sign = r?.turnRate == null || Math.abs(r.turnRate) < cfg.motion.turnRateDegS ? 0 : Math.sign(r.turnRate)
    if (r === undefined || sign === 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < rows.length) {
      const n = rows[j + 1]?.turnRate
      if (n == null || Math.abs(n) < cfg.motion.turnRateDegS || Math.sign(n) !== sign) break
      j++
    }
    const run = rows.slice(i, j + 1)
    const durationSec = (rows[j]?.t ?? r.t) - r.t + rowSec
    if (durationSec >= MIN_TURN_SEC) {
      turns.push({
        atSec: r.t,
        durationSec,
        turnRate: run.reduce((a, x) => a + (x.turnRate ?? 0), 0) / run.length,
        headingChange: headingChange(rows, i, j),
        headYaw: median(run.flatMap((x) => (x.yawDeg === null ? [] : [x.yawDeg]))),
      })
    }
    i = j + 1
  }
  return turns
}

export function checkDrive(log: DriveLogFile, cfg: Config = DEFAULT_CONFIG): DriveReport {
  const rows = log.rows
  const rowSec = log.everyMs / 1000
  const last = rows[rows.length - 1]
  const durationSec = last === undefined ? 0 : last.t + rowSec

  // GPS
  const speeds = rows.flatMap((r) => (r.speedKmh === null ? [] : [r.speedKmh]))
  const fixRatio = rows.length === 0 ? 0 : speeds.length / rows.length
  const gps: DriveReport['gps'] = {
    verdict: fixRatio < GPS_NONE_RATIO ? 'noFix' : fixRatio < GPS_OK_RATIO ? 'weak' : 'ok',
    fixRatio,
    maxKmh: speeds.length === 0 ? null : Math.max(...speeds),
    movingSec: speeds.filter((s) => s > cfg.speed.armAboveKmh).length * rowSec,
    stoppedSec: speeds.filter((s) => s < cfg.speedContext.stoppedBelowKmh).length * rowSec,
  }

  // Alarms: an episode starts where a row has an alarm and the row before has none.
  let alarms = 0
  const stoppedAlarms: DriveReport['stoppedAlarms'] = []
  for (const [i, r] of rows.entries()) {
    if (r.alarm === null || (rows[i - 1]?.alarm ?? null) !== null) continue
    alarms++
    const stopped = r.speedKmh !== null && r.speedKmh < cfg.speedContext.stoppedBelowKmh
    const movingOff = rows.slice(i, i + Math.round(MOVE_OFF_SEC / rowSec) + 1).some((x) => x.speedKmh !== null && x.speedKmh >= cfg.speedContext.stoppedBelowKmh)
    if (stopped && !movingOff) stoppedAlarms.push({ atSec: r.t, level: r.alarm })
  }

  // Gyroscope
  const turns = findTurns(rows, rowSec, cfg)
  const hasGyro = rows.some((r) => r.turnRate !== null)
  const vote = (witness: (t: DriveTurn) => number | null, min: number) => {
    let agree = 0
    let disagree = 0
    for (const t of turns) {
      const w = witness(t)
      if (w === null || Math.abs(w) < min) continue
      if (Math.sign(w) === Math.sign(t.turnRate)) agree++
      else disagree++
    }
    return { agree, disagree }
  }
  const byHeading = vote((t) => t.headingChange, MIN_HEADING_CHANGE_DEG)
  const byHead = vote((t) => t.headYaw, MIN_HEAD_YAW_DEG)
  const pick =
    byHeading.agree + byHeading.disagree >= MIN_HEADING_TURNS
      ? { source: 'heading' as const, ...byHeading }
      : byHead.agree + byHead.disagree >= MIN_HEAD_TURNS
        ? { source: 'head' as const, ...byHead }
        : null
  const current = log.turnRightSign
  let verdict: GyroVerdict
  if (!hasGyro) verdict = 'noSensor'
  else if (pick === null) verdict = 'notEnough'
  else {
    const ratio = pick.agree / (pick.agree + pick.disagree)
    verdict = ratio >= 0.75 ? 'ok' : ratio <= 0.25 ? 'flip' : 'unclear'
  }
  const recommendedSign = verdict === 'ok' ? current : verdict === 'flip' ? (current === 1 ? -1 : 1) : null

  return {
    durationSec,
    truncated: log.truncated,
    gps,
    alarms,
    stoppedAlarms,
    turns,
    gyro: {
      verdict,
      source: verdict === 'noSensor' || verdict === 'notEnough' ? null : (pick?.source ?? null),
      agree: pick?.agree ?? 0,
      disagree: pick?.disagree ?? 0,
      currentSign: current,
      recommendedSign,
    },
  }
}
