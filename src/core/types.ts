/**
 * Shared data types for the pure core. No DOM, no React.
 * See docs/SPEC.md §6.3 and §13.
 */

/** Numbers sent from the vision worker to the main thread, once per frame (SPEC §6.3). */
export interface FrameResult {
  /** Capture timestamp in ms (performance.now). */
  t: number;
  /** Time spent in the model, ms. */
  inferMs: number;
  faceFound: boolean;
  quality: {
    /** Mean luma (0–255) inside the face box. */
    faceLuma: number;
    /** Face box area / frame area. */
    faceAreaRatio: number;
    /** Frame-to-frame motion of stable points (nose bridge). */
    landmarkJitter: number;
  };
  /** L/R = the subject's left/right. blinkL/blinkR are MediaPipe blendshape scores, 0–1. */
  eye?: { earL: number; earR: number; blinkL: number; blinkR: number };
  mouth?: { mar: number; jawOpen: number };
  /** From the facial transformation matrix, in degrees. */
  pose?: { pitchDeg: number; yawDeg: number; rollDeg: number };
  /** Iris offset inside the eye box, −1..1. y < 0 = looking down. */
  gaze?: { x: number; y: number };
  /**
   * Debug mode only: a few landmarks as flat [x0, y0, x1, y1, …], normalized 0–1.
   * Never sent in normal monitoring.
   */
  debugPoints?: number[];
}

/** Can the system see the driver? (SPEC §8.6, §13.2) */
export type SensorState =
  | 'OK'
  | 'DEGRADED'
  | 'EYES_HIDDEN'
  | 'OCCLUDED'
  | 'NO_FACE'
  | 'LOW_VISIBILITY'

/** Sensor states in which the driver's face cannot be read at all. */
export const BLIND_SENSOR_STATES: ReadonlySet<SensorState> = new Set([
  'OCCLUDED',
  'NO_FACE',
  'LOW_VISIBILITY',
])

/** Slow-building fatigue, from PERCLOS, slow blinks, yawns and nods (SPEC §10.2). */
export type FatigueLevel = 'NONE' | 'ADVISORY' | 'STRONG'

/**
 * Per-frame input to the state machine. Detectors (M2) produce this from
 * FrameResult; tests produce it directly.
 * `null` means "unknown this frame" (for example the face is not visible).
 */
export interface FrameSignals {
  t: number;
  sensor: SensorState;
  /** Eyes ≥ 70% closed (SPEC §8.1). */
  eyesClosed: boolean | null;
  /** Degraded-mode substitute for eye closure: head dropped below baseline (SPEC §10.4). */
  headDropped: boolean | null;
  /** Head or gaze away from the road (SPEC §10.3). */
  offRoad: boolean | null;
  /** Eyes clearly open and head pose within limits of baseline (SPEC §11 stop rule). */
  recovered: boolean;
  fatigue: FatigueLevel;
  /** False when the car is known to be stopped (SPEC §10.6). */
  armed: boolean;
}
