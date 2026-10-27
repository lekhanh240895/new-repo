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
    /** Center of the face box, normalized 0–1. Absent when no face. */
    faceCenter?: { x: number; y: number };
  };
  /**
   * L/R = the subject's left/right. blinkL/blinkR are MediaPipe blendshape scores, 0–1.
   * widthL/widthR: eye corner-to-corner distance (fraction of image height). The eye
   * nearer the camera looks wider when the head turns.
   */
  eye?: {
    earL: number;
    earR: number;
    blinkL: number;
    blinkR: number;
    widthL: number;
    widthR: number;
    /**
     * Eye direction from the eyeLook* blendshapes, −1..1, same conventions as
     * `gaze` (x × pose.gazeXRightSign > 0 = right, y > 0 = up). A second opinion
     * to the iris geometry, which is noisy when squinting or behind glasses.
     */
    lookX?: number;
    lookY?: number;
    /** eyeSquint blendshape, mean of both eyes, 0–1 (sun, laughing). */
    squint?: number;
  };
  /** smile: mouthSmile blendshape, mean of both sides, 0–1. */
  mouth?: { mar: number; jawOpen: number; smile?: number };
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

/** A frame after smoothing and quality gates — the input to calibration and detectors. */
export interface ProcessedFrame {
  raw: FrameResult;
  /** Same frame with One Euro smoothing applied to the signals. */
  smooth: FrameResult;
  sensor: SensorState;
  /** False when this frame should not feed detectors (blind, shaking). */
  frameValid: boolean;
  fps: number;
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
 * Per-frame input to the state machine. The signal pipeline (core/detectors)
 * produces this from ProcessedFrame; FSM tests produce it directly.
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
  /** Laugh, sneeze or yawn in progress (or just ended): microsleep waits a bit longer (T9). */
  expression?: boolean;
  /** Drowsy eyes that are not closed: heavy lids, a sinking stare, or repeated near-microsleeps. */
  drowsyEyes?: 'heavy' | 'stare' | 'nearMiss';
  fatigue: FatigueLevel;
  /** False when the car is known to be stopped (SPEC §10.6). */
  armed: boolean;
  /** Distraction alarms allowed (speed context). Default: `armed`. */
  armedD?: boolean;
  /** Microsleep alarms allowed (speed context). Default: `armed`. */
  armedL?: boolean;
  /** Where the driver is looking now (T3). */
  zone?: GazeZone;
  /** Eyes-off-road time before D1 / D2 for the current zone and speed. Default: config.offRoad. */
  offRoadD1Ms?: number;
  offRoadD2Ms?: number;
  /** Whether this look counts toward the "time off road within 30 s" total. Default: true. */
  countsTowardShare?: boolean;
  /** Face lost right after the head dropped fast: treat as eyes closed (T15). */
  assumeClosed?: boolean;
  /** Face lost right after the head turned fast to the side: treat as off road (T15). */
  assumeOffRoad?: boolean;
}

/** Where the driver looks (combined head + eyes), relative to the calibrated road ahead. */
export type GazeZone =
  | 'road'
  | 'up'
  | 'mirrorLeft'
  | 'mirrorRight'
  | 'rearview'
  | 'cluster'
  | 'console'
  | 'lap'
  | 'sideLeft'
  | 'sideRight'

/** From GPS speed (T1). 'unknown' = no GPS fix: treated as moving. */
export type SpeedClass = 'unknown' | 'stopped' | 'maneuver' | 'slow' | 'normal'
