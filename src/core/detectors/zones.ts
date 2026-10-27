/**
 * Gaze zones, speed classes and per-zone budgets
 * (docs/ALERT_ACCURACY_PLAN.md: T1 speed, T2 turning, T3 zones, T6 hysteresis).
 * Pure functions plus one small debounce tracker.
 */
import type { Config, ZoneConfig } from '../config.ts'
import type { GazeZone, SpeedClass } from '../types.ts'

/**
 * Vertical eye direction from two opinions: iris geometry and the eyeLook
 * blendshapes. If they agree on the direction, average them; if they
 * disagree, trust neither (0). Iris noise (smiling, glasses) then cannot fake
 * "looking down" on its own.
 */
export function eyeConsensus(iris: number, blend: number | undefined): number {
  if (blend === undefined) return iris
  if (Math.sign(iris) !== Math.sign(blend)) return 0
  return (iris + blend) / 2
}

/** Combined gaze (head + eyes) in degrees: yaw > 0 = right, pitch > 0 = up. */
export function combinedGaze(
  headRightDeg: number,
  headDownDeg: number,
  eyeRight: number,
  eyeUp: number,
  z: ZoneConfig,
): { yaw: number; pitch: number } {
  return { yaw: headRightDeg + eyeRight * z.eyeYawDeg, pitch: -headDownDeg + eyeUp * z.eyePitchDeg }
}

/** Which zone a gaze direction falls in. `current` gives hysteresis at the road edges. */
export function classifyZone(yaw: number, pitch: number, current: GazeZone, z: ZoneConfig): GazeZone {
  if (yaw >= z.rearviewYaw[0] && yaw <= z.rearviewYaw[1] && pitch >= z.rearviewPitch) return 'rearview'
  if (pitch >= z.upPitch) return 'up'

  const onRoad = current === 'road' || current === 'up'
  const roadYaw = onRoad ? z.roadYaw : z.roadYawReturn
  const downLimit = onRoad ? z.downPitch : z.downPitchReturn
  if (Math.abs(yaw) <= roadYaw && pitch >= downLimit) return 'road'

  if (pitch < downLimit) {
    if (yaw >= z.consoleYaw[0] && yaw <= z.consoleYaw[1]) return 'console'
    if (pitch < z.lapPitch) return 'lap'
    if (Math.abs(yaw) <= z.clusterYaw) return 'cluster'
    return 'lap'
  }
  if (yaw < 0) return yaw >= z.mirrorLeftYaw ? 'mirrorLeft' : 'sideLeft'
  if (yaw >= z.mirrorRightYaw[0] && yaw <= z.mirrorRightYaw[1]) return 'mirrorRight'
  return 'sideRight'
}

export interface ZoneTracker {
  /** Feeds the raw zone (null = cannot tell); returns the debounced zone. */
  update(t: number, raw: GazeZone | null): GazeZone | null;
  current(): GazeZone;
}

/** A new zone must last `dwellMs` before it replaces the current one (T6). */
export function createZoneTracker(dwellMs: number): ZoneTracker {
  let zone: GazeZone = 'road'
  let candidate: GazeZone | null = null
  let candidateSince = 0
  return {
    update(t, raw) {
      if (raw === null) {
        candidate = null
        return null
      }
      if (raw === zone) {
        candidate = null
      } else if (raw !== candidate) {
        candidate = raw
        candidateSince = t
      } else if (t - candidateSince >= dwellMs) {
        zone = raw
        candidate = null
      }
      return zone
    },
    current: () => zone,
  }
}

/** GPS speed → speed class. No GPS fix: "unknown" (= moving), or "maneuver" if the phone has been very still. */
export function speedClass(speedKmh: number | null, still: boolean, cfg: Config['speedContext']): SpeedClass {
  if (speedKmh === null) return still ? 'maneuver' : 'unknown'
  if (speedKmh < cfg.stoppedBelowKmh) return 'stopped'
  if (speedKmh < cfg.maneuverBelowKmh) return 'maneuver'
  if (speedKmh < cfg.slowBelowKmh) return 'slow'
  return 'normal'
}

export interface ZonePolicy {
  offRoad: boolean;
  /** Off road only because the car is turning and the driver looks into the turn. */
  turningInto: boolean;
  d1Ms: number;
  d2Ms: number;
  countsTowardShare: boolean;
}

const SIDE_ZONES: ReadonlySet<GazeZone> = new Set(['mirrorLeft', 'mirrorRight', 'sideLeft', 'sideRight', 'rearview'])
/** Looks that are part of driving do not add to the "time off road within 30 s" total. */
const SHARE_ZONES: ReadonlySet<GazeZone> = new Set(['lap', 'console', 'sideLeft', 'sideRight'])

/**
 * Budget for a zone at a speed. Phone/lap and console budgets never relax with
 * speed (guard B12). Looking into a turn counts as looking at the road (T2).
 */
export function zonePolicy(zone: GazeZone, gazeYaw: number, speed: SpeedClass, turnRate: number | null, cfg: Config): ZonePolicy {
  const b = cfg.budgets
  if (zone === 'road' || zone === 'up') {
    return { offRoad: false, turningInto: false, d1Ms: cfg.offRoad.d1Ms, d2Ms: cfg.offRoad.d2Ms, countsTowardShare: false }
  }

  const turningInto =
    turnRate !== null &&
    Math.abs(turnRate) >= cfg.motion.turnRateDegS &&
    Math.sign(turnRate) === Math.sign(gazeYaw) &&
    Math.abs(gazeYaw) <= cfg.motion.turnMaxGazeDeg &&
    SIDE_ZONES.has(zone)
  if (turningInto) {
    return { offRoad: false, turningInto: true, d1Ms: cfg.offRoad.d1Ms, d2Ms: cfg.offRoad.d2Ms, countsTowardShare: false }
  }

  let d1: number
  switch (zone) {
    case 'mirrorLeft':
    case 'mirrorRight':
      d1 = b.mirrorMs
      break
    case 'rearview':
      d1 = b.rearviewMs
      break
    case 'sideLeft':
    case 'sideRight':
      d1 = b.sideMs
      break
    case 'cluster':
      d1 = b.clusterMs
      break
    case 'console':
      d1 = b.consoleMs
      break
    case 'lap':
      d1 = b.lapMs
      break
  }
  if (speed === 'slow' && SIDE_ZONES.has(zone)) d1 = Math.max(d1, b.slowSideMs)
  return { offRoad: true, turningInto: false, d1Ms: d1, d2Ms: d1 + b.escalateMs, countsTowardShare: SHARE_ZONES.has(zone) }
}
