import { describe, expect, it } from 'vitest'
import { createDriveLog, parseDriveLog, type DriveRow } from './log.ts'

const row = (over: Partial<Omit<DriveRow, 't'>> = {}): Omit<DriveRow, 't'> => ({
  speedKmh: 40,
  headingDeg: 90,
  turnRate: 0,
  still: false,
  yawDeg: 0,
  downDeg: 0,
  zone: 'road',
  armedD: true,
  armedL: true,
  alarm: null,
  ...over,
})

describe('drive log (P8)', () => {
  it('keeps one row every 500 ms, with time in seconds from the start', () => {
    const log = createDriveLog(1)
    for (let t = 1000; t <= 3050; t += 66) log.add(t, row())
    const rows = log.file().rows
    expect(rows).toHaveLength(5)
    // Each row carries its frame time: at most one frame (66 ms, shown to 0.1 s) after its grid point.
    rows.forEach((r, i) => expect(Math.abs(r.t - i * 0.5)).toBeLessThanOrEqual(0.1 + 1e-9))
  })

  it('does not lose a short alarm that falls between two rows', () => {
    const log = createDriveLog(1)
    log.add(0, row())
    log.add(100, row({ alarm: 'D1' }))
    log.add(200, row({ alarm: 'D2' }))
    log.add(300, row())
    log.add(500, row())
    expect(log.file().rows.map((r) => r.alarm)).toEqual([null, 'D2'])
  })

  it('stops at the size limit and says so', () => {
    const log = createDriveLog(-1, 500, 3)
    for (let t = 0; t < 5000; t += 500) log.add(t, row())
    const file = log.file()
    expect(file.rows).toHaveLength(3)
    expect(file.truncated).toBe(true)
    expect(file.turnRightSign).toBe(-1)
  })

  it('round-trips through JSON and rejects other files', () => {
    const log = createDriveLog(1)
    log.add(0, row())
    const parsed = parseDriveLog(JSON.parse(JSON.stringify(log.file())))
    expect('log' in parsed && parsed.log.rows).toHaveLength(1)
    expect(parseDriveLog({ clips: [] })).toEqual({ error: 'not a BioMonitor drive log' })
    expect(parseDriveLog(null)).toEqual({ error: 'not a JSON object' })
    expect(parseDriveLog({ kind: 'biomonitor-drive-log', version: 1, turnRightSign: 1, rows: [{}] })).toEqual({ error: 'row 0 is not valid' })
  })

  it('never stores a position', () => {
    const log = createDriveLog(1)
    log.add(0, row())
    const keys = Object.keys(log.file().rows[0] ?? {})
    expect(keys).not.toContain('latitude')
    expect(keys).not.toContain('longitude')
  })
})
