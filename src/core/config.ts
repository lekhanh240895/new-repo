/**
 * Every threshold in one place (SPEC §8–§11).
 * These are starting defaults. Tune them with replay and field data (SPEC §15).
 */

export interface QualityConfig {
  /** Bad light or a too-small face must last this long before LOW_VISIBILITY. */
  badLightMs: number;
  minFaceLuma: number;
  maxFaceLuma: number;
  minFaceAreaRatio: number;
  jitterFactor: number;
  jitterMs: number;
  /** A lost face counts as OCCLUDED (hand, cup) for this long, then NO_FACE. */
  occlusionMaxMs: number;
  minFps: number;
  minFpsWindowMs: number;
}

export interface CalibrationConfig {
  durationMs: number;
  minBlinks: number;
  maxPoseSpreadDeg: number;
  minValidRatio: number;
  maxAttempts: number;
  /** Fallback when no blink minimum was seen: EAR_closed = EAR_open × this. */
  closedFromOpenRatio: number;
  /** Quantile of open-eye EAR used for EAR_open, at calibration and online (0.5 = median). */
  openQuantile: number;
  onlineWindowMs: number;
  maxDriftRatio: number;
  recalibratePoseShiftDeg: number;
  recalibrateAfterMs: number;
}

export interface EyeConfig {
  /** Weight of normalized EAR vs blendshape in the fused openness value. */
  earWeight: number;
  closedBelow: number;
  openAbove: number;
  /** Beyond this |yaw| the far eye is ignored. */
  farEyeYawDeg: number;
  blinkMinMs: number;
  blinkMaxMs: number;
  slowBlinkMaxMs: number;
}

export interface MicrosleepConfig {
  l1Ms: number;
  l2Ms: number;
  l3Ms: number;
  /**
   * If the face is lost while the eyes have been closed at least this long,
   * keep counting the closure (worst case wins, SPEC §10.5).
   */
  carryClosureMinMs: number;
}

export interface FatigueConfig {
  perclosWindowMs: number;
  perclosMinValidRatio: number;
  perclosAdvisory: number;
  perclosStrong: number;
  slowBlinkWindowMs: number;
  slowBlinksAdvisory: number;
  slowBlinksStrong: number;
  yawnWindowMs: number;
  yawnsAdvisory: number;
  yawnsStrong: number;
  yawnOpenAbove: number;
  yawnMinMs: number;
  /** Mouth open/close cycles per second at or above this = talking or singing. */
  speechCyclesPerSec: number;
  nodWindowMs: number;
  nodsAdvisory: number;
  nodsStrong: number;
  nodDropDeg: number;
  nodDropMaxMs: number;
  nodRecoverMs: number;
  /** STRONG fatigue lowers microsleep thresholds by this much... */
  strongThresholdShiftMs: number;
  /** ...for this long. */
  strongShiftDurationMs: number;
  /** After an L2/L3 alarm, fatigue stays at least ADVISORY for this long. */
  postAlarmAdvisoryMs: number;
  advisoryRepeatMs: number;
  strongRepeatMs: number;
}

export interface OffRoadConfig {
  yawDeg: number;
  pitchDownDeg: number;
  gazeDownBelow: number;
  d1Ms: number;
  d2Ms: number;
  windowMs: number;
  windowTotalMs: number;
}

export interface DegradedConfig {
  headDropDeg: number;
}

export interface AlertConfig {
  /** Eyes open and pose OK continuously for this long stops an alarm. */
  recoveryMs: number;
  recoveryPoseDeg: number;
  /** Not seeing the driver for this long triggers the "monitoring off" chime. */
  monitoringOffAfterMs: number;
  monitoringOffRepeatMs: number;
  /** Frame gaps larger than this are clamped when summing off-road time. */
  maxFrameGapMs: number;
}

export interface SpeedConfig {
  armAboveKmh: number;
  debugOffAboveKmh: number;
}

export interface PoseConfig {
  /**
   * `(pitch − baseline) × headDownSign > 0` means "head down".
   * −1 assumes MediaPipe pitch goes negative when nodding down. Confirm on a
   * real device in Debug mode (SPEC §17.1); flip to 1 if it is the other way.
   */
  headDownSign: 1 | -1;
  /** Within this many degrees of baseline counts as "level" (nod start and end). */
  levelDeg: number;
}

export interface MouthConfig {
  /** Weight of the jawOpen blendshape vs normalized MAR in mouth openness. */
  jawWeight: number;
  /** MAR above baseline that counts as fully open. */
  marSpan: number;
  /** Mouth openness crossing this level counts as one open/close cycle (speech check). */
  speechCrossLevel: number;
}

export interface SetupConfig {
  /** The face must be seen with good quality this long to pass the setup check. */
  okForMs: number;
  /** Give up after this long and show what is wrong. */
  timeoutMs: number;
}

export interface WatchdogConfig {
  /** No processed frame for this long means the pipeline stalled (SPEC §12 F20). */
  stallMs: number;
  /** Limit for the first frame after an engine (re)start: GPU warm-up can take seconds. */
  startupMs: number;
  /** Restart attempts before staying in FAULT. */
  maxRestarts: number;
}

export interface PerformanceConfig {
  targetFps: number;
  normalWidth: number;
  /** Frame width used when the device is too slow (SPEC §12 F6). */
  lowWidth: number;
  lowFpsBelow: number;
  lowForMs: number;
  /** GPU slower than this per frame: try the CPU delegate and keep the faster one. */
  gpuSlowMs: number;
  /** Frames measured per delegate before deciding. */
  tuneFrames: number;
}

export interface Config {
  quality: QualityConfig;
  calibration: CalibrationConfig;
  eye: EyeConfig;
  microsleep: MicrosleepConfig;
  fatigue: FatigueConfig;
  offRoad: OffRoadConfig;
  degraded: DegradedConfig;
  alert: AlertConfig;
  speed: SpeedConfig;
  pose: PoseConfig;
  mouth: MouthConfig;
  setup: SetupConfig;
  watchdog: WatchdogConfig;
  performance: PerformanceConfig;
}

const SECOND = 1000
const MINUTE = 60 * SECOND

export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze<Config>({
  quality: {
    badLightMs: 1 * SECOND,
    minFaceLuma: 40,
    maxFaceLuma: 220,
    minFaceAreaRatio: 0.04,
    jitterFactor: 3,
    jitterMs: 500,
    occlusionMaxMs: 1.5 * SECOND,
    minFps: 8,
    minFpsWindowMs: 3 * SECOND,
  },
  calibration: {
    durationMs: 8 * SECOND,
    minBlinks: 2,
    maxPoseSpreadDeg: 8,
    minValidRatio: 0.7,
    maxAttempts: 3,
    closedFromOpenRatio: 0.35,
    openQuantile: 0.5,
    onlineWindowMs: 5 * MINUTE,
    maxDriftRatio: 0.15,
    recalibratePoseShiftDeg: 15,
    recalibrateAfterMs: 30 * SECOND,
  },
  eye: {
    earWeight: 0.6,
    closedBelow: 0.3,
    openAbove: 0.6,
    farEyeYawDeg: 25,
    blinkMinMs: 50,
    blinkMaxMs: 400,
    slowBlinkMaxMs: 1000,
  },
  microsleep: {
    l1Ms: 1.0 * SECOND,
    l2Ms: 1.5 * SECOND,
    l3Ms: 2.0 * SECOND,
    carryClosureMinMs: 400,
  },
  fatigue: {
    perclosWindowMs: 60 * SECOND,
    perclosMinValidRatio: 0.7,
    perclosAdvisory: 0.15,
    perclosStrong: 0.25,
    slowBlinkWindowMs: 5 * MINUTE,
    slowBlinksAdvisory: 6,
    slowBlinksStrong: 12,
    yawnWindowMs: 10 * MINUTE,
    yawnsAdvisory: 3,
    yawnsStrong: 5,
    yawnOpenAbove: 0.6,
    yawnMinMs: 1.2 * SECOND,
    speechCyclesPerSec: 2,
    nodWindowMs: 5 * MINUTE,
    nodsAdvisory: 1,
    nodsStrong: 2,
    nodDropDeg: 15,
    nodDropMaxMs: 600,
    nodRecoverMs: 3 * SECOND,
    strongThresholdShiftMs: 200,
    strongShiftDurationMs: 15 * MINUTE,
    postAlarmAdvisoryMs: 15 * MINUTE,
    advisoryRepeatMs: 10 * MINUTE,
    strongRepeatMs: 5 * MINUTE,
  },
  offRoad: {
    yawDeg: 30,
    pitchDownDeg: 20,
    gazeDownBelow: -0.5,
    d1Ms: 2.0 * SECOND,
    d2Ms: 3.5 * SECOND,
    windowMs: 30 * SECOND,
    windowTotalMs: 6 * SECOND,
  },
  degraded: {
    headDropDeg: 15,
  },
  alert: {
    recoveryMs: 2.0 * SECOND,
    recoveryPoseDeg: 15,
    monitoringOffAfterMs: 10 * SECOND,
    monitoringOffRepeatMs: 60 * SECOND,
    maxFrameGapMs: 500,
  },
  speed: {
    armAboveKmh: 10,
    debugOffAboveKmh: 5,
  },
  pose: {
    headDownSign: -1,
    levelDeg: 5,
  },
  mouth: {
    jawWeight: 0.5,
    marSpan: 0.6,
    speechCrossLevel: 0.35,
  },
  setup: {
    okForMs: 1.5 * SECOND,
    timeoutMs: 15 * SECOND,
  },
  watchdog: {
    stallMs: 1 * SECOND,
    startupMs: 10 * SECOND,
    maxRestarts: 3,
  },
  performance: {
    targetFps: 15,
    normalWidth: 480,
    lowWidth: 320,
    lowFpsBelow: 10,
    lowForMs: 5 * SECOND,
    gpuSlowMs: 50,
    tuneFrames: 30,
  },
})
