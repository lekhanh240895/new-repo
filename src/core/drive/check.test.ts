import { describe, expect, it } from 'vitest'
import { checkDrive, headingDelta } from './check.ts'
import type { DriveLogFile, DriveRow } from './log.ts'

type Part = Partial<Omit<DriveRow, 't'>>

/** Builds a log from segments of `sec` seconds, two rows a second. Heading follows the turn when `turnDeg` is set. */
function drive(segments: { sec: number; row?: Part; turnDeg?: number }[], sign: 1 | -1 = 1): DriveLogFile {
  const rows: DriveRow[] = []
  let heading = 90
  for (const seg of segments) {
    const n = Math.round(seg.sec * 2)
    for (let k = 0; k < n; k++) {
      if (seg.turnDeg !== undefined) heading = (heading + seg.turnDeg / n + 360) % 360
      rows.push({
        t: rows.length / 2,
        speedKmh: 40,
        headingDeg: heading,
        turnRate: 0,
        still: false,
        yawDeg: 0,
        downDeg: 0,
        zone: 'road',
        armedD: true,
        armedL: true,
        alarm: null,
        ...seg.row,
      })
    }
  }
  return { kind: 'biomonitor-drive-log', version: 1, turnRightSign: sign, everyMs: 500, truncated: false, rows }
}

const straight = { sec: 10 }
/** A 90° corner in 4 s; the gyroscope reads `gyro` °/s. */
const corner = (dir: 1 | -1, gyro: number, extra: Part = {}) => ({ sec: 4, turnDeg: 90 * dir, row: { turnRate: gyro, ...extra } })

describe('heading difference', () => {
  it('is signed and wraps around north', () => {
    expect(headingDelta(350, 20)).toBe(30)
    expect(headingDelta(20, 350)).toBe(-30)
    expect(headingDelta(90, 180)).toBe(90)
  })
})

describe('drive check: gyroscope sign (P8)', () => {
  it('right turns read as right: the sign is OK', () => {
    const r = checkDrive(drive([straight, corner(1, 22), straight, corner(-1, -22), straight, corner(1, 20), straight, corner(-1, -25), straight]))
    expect(r.turns).toHaveLength(4)
    expect(r.gyro).toMatchObject({ verdict: 'ok', source: 'heading', agree: 4, disagree: 0, recommendedSign: 1 })
  })

  it('a gyroscope that reads right turns as left: flip the sign', () => {
    const r = checkDrive(drive([straight, corner(1, -22), straight, corner(-1, 22), straight, corner(1, -20), straight], -1))
    expect(r.gyro).toMatchObject({ verdict: 'flip', agree: 0, disagree: 3, currentSign: -1, recommendedSign: 1 })
  })

  it('a turn through north is still a right turn', () => {
    const north = drive([{ sec: 2, row: { headingDeg: 330 } }, { sec: 4, row: { turnRate: 20 } }, { sec: 10, row: { headingDeg: 30 } }])
    // Heading 330 → 30 (through 0) during the turn: +60°.
    north.rows.forEach((r, i) => { if (i >= 4 && i < 12) r.headingDeg = (330 + (i - 3) * 7.5) % 360 })
    expect(checkDrive(north).turns[0]?.headingChange).toBeCloseTo(60)
  })

  it('needs at least three clear turns', () => {
    expect(checkDrive(drive([straight, corner(1, 22), straight, corner(-1, -22), straight])).gyro.verdict).toBe('notEnough')
  })

  it('mixed answers stay "unclear" instead of guessing', () => {
    const r = checkDrive(drive([straight, corner(1, 22), straight, corner(1, -22), straight, corner(-1, -22), straight, corner(-1, 22), straight]))
    expect(r.gyro).toMatchObject({ verdict: 'unclear', recommendedSign: null })
  })

  it('without GPS heading, the head looking into the turn is a weaker witness (5 turns needed)', () => {
    const noHeading = { headingDeg: null }
    const five = [1, -1, 1, -1, 1].flatMap((d) => [{ sec: 10, row: noHeading }, corner(d as 1 | -1, 20 * d, { ...noHeading, yawDeg: 15 * d })])
    expect(checkDrive(drive(five)).gyro).toMatchObject({ verdict: 'ok', source: 'head' })
    expect(checkDrive(drive(five.slice(0, 8))).gyro.verdict).toBe('notEnough')
  })

  it('ignores short wobbles (lane change)', () => {
    expect(checkDrive(drive([straight, { sec: 1, row: { turnRate: 15 } }, straight])).turns).toHaveLength(0)
  })

  it('says "no sensor" when the phone gave no gyroscope', () => {
    expect(checkDrive(drive([{ sec: 30, row: { turnRate: null } }])).gyro.verdict).toBe('noSensor')
  })
})

describe('drive check: GPS and alarms (P8)', () => {
  it('reports GPS coverage, top speed and time moving / stopped', () => {
    const r = checkDrive(drive([{ sec: 20, row: { speedKmh: 50 } }, { sec: 10, row: { speedKmh: 0 } }]))
    expect(r.gps).toMatchObject({ verdict: 'ok', fixRatio: 1, maxKmh: 50, movingSec: 20, stoppedSec: 10 })
    expect(r.durationSec).toBe(30)
  })

  it('weak or no GPS', () => {
    expect(checkDrive(drive([{ sec: 10 }, { sec: 10, row: { speedKmh: null } }])).gps.verdict).toBe('weak')
    expect(checkDrive(drive([{ sec: 20, row: { speedKmh: null } }])).gps.verdict).toBe('noFix')
  })

  it('flags an alarm that starts while stopped, but not the moving-off alert', () => {
    const r = checkDrive(drive([
      { sec: 5, row: { speedKmh: 0 } },
      { sec: 1, row: { speedKmh: 0, alarm: 'L1' } },
      { sec: 5, row: { speedKmh: 0 } },
      { sec: 1, row: { speedKmh: 1, alarm: 'D1' } },
      { sec: 3, row: { speedKmh: 15, alarm: 'D1' } },
      { sec: 5, row: { speedKmh: 30 } },
    ]))
    expect(r.alarms).toBe(2)
    expect(r.stoppedAlarms).toEqual([{ atSec: 5, level: 'L1' }])
  })
})
