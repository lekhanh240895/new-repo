/**
 * Drive log (plan P8): a few numbers twice a second during monitoring, so a real
 * drive can check the GPS speed and the gyroscope turn sign afterwards.
 *
 * Privacy: no position (no latitude/longitude), no images, no landmarks. The log
 * lives in memory and leaves the phone only if the driver saves it.
 */
import { alertRank } from '../fsm/monitoring.ts'
import type { AlarmLevel } from '../fsm/types.ts'
import type { GazeZone } from '../types.ts'

export interface DriveRow {
  /** Seconds since the log started. */
  t: number;
  speedKmh: number | null;
  /** GPS direction of travel, degrees clockwise from north; null = unknown (stopped, no fix). */
  headingDeg: number | null;
  /** Gyroscope turn rate, °/s, already multiplied by `motion.turnRightSign` (> 0 = right); null = no sensor. */
  turnRate: number | null;
  still: boolean;
  /** Head turn from the calibrated position (> 0 = right); null = face not seen. */
  yawDeg: number | null;
  /** Head below the calibrated position (> 0 = down). */
  downDeg: number | null;
  zone: GazeZone | null;
  armedD: boolean;
  armedL: boolean;
  /** Highest alarm active since the previous row (short alarms are not lost between rows). */
  alarm: AlarmLevel | null;
}

export interface DriveLogFile {
  kind: 'biomonitor-drive-log';
  version: 1;
  /** The turn sign the rows were recorded with, so the check can say "keep" or "flip". */
  turnRightSign: 1 | -1;
  everyMs: number;
  /** True when the trip was longer than the log can hold: the newest rows were dropped. */
  truncated: boolean;
  rows: DriveRow[];
}

export interface DriveLog {
  /** Feed every monitoring frame; a row is kept every `everyMs`. `tMs` is the frame time. */
  add(tMs: number, row: Omit<DriveRow, 't'>): void;
  file(): DriveLogFile;
}

function higher(a: AlarmLevel | null, b: AlarmLevel | null): AlarmLevel | null {
  return alertRank(b) > alertRank(a) ? b : a
}

/** About 4 hours at 2 rows a second. */
export const DRIVE_LOG_MAX_ROWS = 28_800

export function createDriveLog(turnRightSign: 1 | -1, everyMs = 500, maxRows = DRIVE_LOG_MAX_ROWS): DriveLog {
  const rows: DriveRow[] = []
  let startMs: number | null = null
  /** Rows sit on a fixed grid (every `everyMs` from the start), so frame timing does not make them drift. */
  let nextRowMs = -Infinity
  let pendingAlarm: AlarmLevel | null = null
  let truncated = false

  return {
    add(tMs, row) {
      startMs ??= tMs
      pendingAlarm = higher(pendingAlarm, row.alarm)
      if (tMs < nextRowMs) return
      if (rows.length >= maxRows) {
        truncated = true
        return
      }
      nextRowMs = Math.max(nextRowMs + everyMs, startMs + everyMs)
      while (nextRowMs <= tMs) nextRowMs += everyMs
      rows.push({ ...row, t: Math.round((tMs - startMs) / 100) / 10, alarm: pendingAlarm })
      pendingAlarm = null
    },
    file: () => ({ kind: 'biomonitor-drive-log', version: 1, turnRightSign, everyMs, truncated, rows: [...rows] }),
  }
}

/** Reads a saved log; returns an error message instead of throwing on a bad file. */
export function parseDriveLog(data: unknown): { log: DriveLogFile } | { error: string } {
  if (typeof data !== 'object' || data === null) return { error: 'not a JSON object' }
  const d = data as Partial<DriveLogFile>
  if (d.kind !== 'biomonitor-drive-log') return { error: 'not a BioMonitor drive log' }
  if (d.version !== 1) return { error: `unsupported version ${String(d.version)}` }
  if (d.turnRightSign !== 1 && d.turnRightSign !== -1) return { error: 'missing turnRightSign' }
  if (!Array.isArray(d.rows)) return { error: 'missing rows' }
  const bad = d.rows.findIndex((r: unknown) => typeof r !== 'object' || r === null || typeof (r as DriveRow).t !== 'number')
  if (bad >= 0) return { error: `row ${bad} is not valid` }
  return { log: { kind: d.kind, version: 1, turnRightSign: d.turnRightSign, everyMs: d.everyMs ?? 500, truncated: d.truncated === true, rows: d.rows } }
}
