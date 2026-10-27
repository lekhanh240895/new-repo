import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.ts'
import { classifyZone, combinedGaze, createZoneTracker, eyeConsensus, speedClass, zonePolicy } from './zones.ts'

const cfg = DEFAULT_CONFIG
const z = cfg.zones

describe('eye consensus (iris + blendshape)', () => {
  it('averages two opinions that agree', () => {
    expect(eyeConsensus(-0.8, -0.6)).toBeCloseTo(-0.7)
  })
  it('trusts neither when they disagree (iris noise cannot fake "down")', () => {
    expect(eyeConsensus(-0.7, 0.1)).toBe(0)
  })
  it('falls back to the iris without a blendshape', () => {
    expect(eyeConsensus(-0.4, undefined)).toBe(-0.4)
  })
})

describe('combined gaze', () => {
  it('adds the eyes to the head', () => {
    // Head 35° left, eyes back to the right: looking at the road (A34).
    expect(combinedGaze(-35, 0, 0.7, 0, z).yaw).toBeCloseTo(-14)
    // Head 15° down, eyes down: pitch well below the road.
    expect(combinedGaze(0, 15, 0, -0.8, z).pitch).toBeCloseTo(-35)
  })
})

describe('zone classification (left-hand-drive car)', () => {
  const at = (yaw: number, pitch: number, current = 'road' as const) => classifyZone(yaw, pitch, current, z)

  it('road, up, mirrors, sides', () => {
    expect(at(0, 0)).toBe('road')
    expect(at(5, 25)).toBe('up')
    expect(at(-45, 0)).toBe('mirrorLeft')
    expect(at(-75, 0)).toBe('sideLeft')
    expect(at(60, 0)).toBe('mirrorRight')
    expect(at(40, 0)).toBe('sideRight')
    expect(at(85, 0)).toBe('sideRight')
  })

  it('rear-view mirror is up-right', () => {
    expect(at(30, 15)).toBe('rearview')
  })

  it('down: speedometer, center console, lap', () => {
    expect(at(0, -20)).toBe('cluster')
    expect(at(25, -25)).toBe('console')
    expect(at(0, -40)).toBe('lap')
    expect(at(-30, -25)).toBe('lap')
  })

  it('has hysteresis at the road edge (T6)', () => {
    expect(classifyZone(27, 0, 'road', z)).toBe('road')
    expect(classifyZone(27, 0, 'sideRight', z)).toBe('sideRight')
    expect(classifyZone(20, 0, 'sideRight', z)).toBe('road')
  })
})

describe('zone debounce (T6)', () => {
  it('ignores a zone that lasts less than 150 ms', () => {
    const tr = createZoneTracker(150)
    tr.update(0, 'road')
    expect(tr.update(66, 'lap')).toBe('road')
    expect(tr.update(133, 'road')).toBe('road')
  })
  it('switches after the dwell time', () => {
    const tr = createZoneTracker(150)
    tr.update(0, 'road')
    tr.update(66, 'lap')
    tr.update(133, 'lap')
    expect(tr.update(233, 'lap')).toBe('lap')
  })
  it('returns null when the zone cannot be told', () => {
    expect(createZoneTracker(150).update(0, null)).toBeNull()
  })
})

describe('speed classes (T1)', () => {
  const sc = (kmh: number | null, still = false) => speedClass(kmh, still, cfg.speedContext)
  it('maps GPS speed', () => {
    expect(sc(0)).toBe('stopped')
    expect(sc(5)).toBe('maneuver')
    expect(sc(20)).toBe('slow')
    expect(sc(60)).toBe('normal')
  })
  it('no GPS: moving, unless the phone has been very still', () => {
    expect(sc(null)).toBe('unknown')
    expect(sc(null, true)).toBe('maneuver')
  })
  it('GPS wins over the accelerometer (guard B14)', () => {
    expect(sc(90, true)).toBe('normal')
  })
})

describe('zone budgets', () => {
  const policy = (zone: Parameters<typeof zonePolicy>[0], yaw = 0, speed: Parameters<typeof zonePolicy>[2] = 'normal', turn: number | null = null) =>
    zonePolicy(zone, yaw, speed, turn, cfg)

  it('road and up are not off road', () => {
    expect(policy('road').offRoad).toBe(false)
    expect(policy('up').offRoad).toBe(false)
  })

  it('mirrors get longer than phone / lap', () => {
    expect(policy('mirrorLeft', -45).d1Ms).toBe(2500)
    expect(policy('rearview', 30).d1Ms).toBe(3000)
    expect(policy('lap').d1Ms).toBe(2000)
  })

  it('slow speed relaxes side and mirror looks only — never phone, lap or console (guard B12)', () => {
    expect(policy('sideRight', 40, 'slow').d1Ms).toBe(3500)
    expect(policy('lap', 0, 'slow').d1Ms).toBe(2000)
    expect(policy('console', 25, 'slow').d1Ms).toBe(2000)
  })

  it('driving looks do not count toward the 30 s total; phone and side looks do', () => {
    expect(policy('mirrorLeft', -45).countsTowardShare).toBe(false)
    expect(policy('cluster').countsTowardShare).toBe(false)
    expect(policy('lap').countsTowardShare).toBe(true)
    expect(policy('sideRight', 40).countsTowardShare).toBe(true)
  })

  it('looking into a turn is driving; looking against it is not (T2)', () => {
    expect(policy('mirrorRight', 60, 'normal', 20).offRoad).toBe(false)
    expect(policy('mirrorRight', 60, 'normal', -20).offRoad).toBe(true)
    // The phone is never "into the turn".
    expect(policy('lap', 10, 'normal', 20).offRoad).toBe(true)
  })
})
