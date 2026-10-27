/**
 * Scenario library format (docs/ALERT_ACCURACY_PLAN.md, fix T13).
 *
 * A scenario describes what the camera "sees" and what the car does, as timed
 * segments, plus what the app SHOULD do. The runner plays it through the real
 * quality gates, smoothing, detectors and state machine.
 *
 * Angle conventions (relative to the calibrated "road ahead"):
 *   yaw  < 0 = driver looks LEFT,  > 0 = RIGHT
 *   pitch < 0 = head DOWN,         > 0 = UP
 *   gazeX/gazeY: eyes inside the head, −1..1 (x < 0 left, y < 0 down)
 * Vietnam: left-hand-drive cars, so the left mirror is close (≈ −40°) and the
 * right mirror far (≈ +60°); the rear-view mirror is up-right.
 */
import type { Baseline } from '../core/calibration/baseline.ts'

/** What the camera sees during a segment. Anything left out = alert driver looking at the road. */
export interface Look {
  /** false = face not found (turned away, hand over face, dark). */
  face?: boolean;
  yaw?: number;
  pitch?: number;
  gazeX?: number;
  gazeY?: number;
  /** Eye aspect ratio for both eyes (calibrated open = 0.3, closed ≈ 0.06). */
  ear?: number;
  earL?: number;
  earR?: number;
  /** MediaPipe eyeBlink blendshape, 0–1. */
  blink?: number;
  blinkL?: number;
  blinkR?: number;
  widthL?: number;
  widthR?: number;
  mar?: number;
  jaw?: number;
  luma?: number;
  area?: number;
  jitter?: number;
  /**
   * Signals the v0.1 pipeline does not read yet (added in P2+). Scenarios set
   * them now so the expected results stay the same when the fixes land.
   */
  future?: {
    eyeLookDown?: number;
    eyeLookOut?: number;
    eyeSquint?: number;
    smile?: number;
    mask?: boolean;
    handOnFace?: boolean;
  };
}

/** What the car does during a segment. */
export interface Context {
  /** GPS speed in km/h; null = no GPS fix. */
  speed?: number | null;
  /** Location permission given (decision 2: suggested by default). */
  location?: boolean;
  /** Car turning rate from the gyroscope, °/s (> 0 = turning right). Not used by v0.1. */
  turn?: number;
  /** Road bump / jolt felt by the accelerometer. Not used by v0.1. */
  bump?: boolean;
  /** Hard braking. Not used by v0.1. */
  brake?: boolean;
  /** Accelerometer reads "very still" (could mean stopped). Not used by v0.1. */
  accelStill?: boolean;
}

export interface Segment {
  ms: number;
  look?: Look;
  ctx?: Context;
  /** Name this moment, so expectations can refer to it. */
  mark?: string;
}

export type AlarmFamily = 'D' | 'L'

export type Expectation =
  /** No alarm (of a family, if given) in the window between two marks (default: whole scenario). */
  | { kind: 'noAlarm'; family?: AlarmFamily; from?: string; to?: string }
  /** An alarm of this family starts within `within` ms after the mark (default: scenario start). */
  | { kind: 'alarm'; family: AlarmFamily; after?: string; within: number }
  /** This exact level never fires (e.g. no escalation to D2). */
  | { kind: 'noLevel'; level: 'D1' | 'D2' | 'L1' | 'L2' | 'L3' }
  /** A fatigue advisory is spoken within `within` ms after the mark. */
  | { kind: 'advisory'; after?: string; within: number }
  | { kind: 'noAdvisory' }
  /** The active alarm stops within `within` ms after the mark. */
  | { kind: 'stops'; after: string; within: number }
  /** The alarm steps down (lower level or stop) within `within` ms after the mark. */
  | { kind: 'deescalates'; after: string; within: number }
  /** At most `count` alarms of a family in the whole scenario (rate limit). */
  | { kind: 'maxAlarms'; family: AlarmFamily; count: number }
  | { kind: 'chime'; chime: 'monitoringOff' | 'paused' }

export type TestType = 'S' | 'S,D' | 'S,R' | 'R'

export interface Scenario {
  /** Same ID as the plan, e.g. "A01". */
  id: string;
  title: string;
  testType: TestType;
  /** Plan fixes this case depends on, e.g. ["T1", "T5"]. */
  fixes: readonly string[];
  /** Calibrated baseline overrides (default: open EAR 0.3, closed 0.06, straight ahead). */
  baseline?: Partial<Baseline>;
  /** Default car context for all segments (default: 50 km/h, location on). */
  ctx?: Context;
  fps?: number;
  segments?: readonly Segment[];
  expect?: readonly Expectation[];
  /**
   * For cases that are not a frame sequence (pure functions, missing features).
   * Returns null when it passes, else the reason.
   */
  check?: () => string | null;
  /** Only a real recorded clip can test this (synthetic frames would prove nothing). */
  clipOnly?: string;
  /** Modelling assumptions to confirm with real clips (e.g. "EAR drops 55% when looking down"). */
  assumptions?: readonly string[];
}
