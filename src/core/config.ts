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
  /** Calibrated head angle beyond this means the phone is mounted too far to the side (A23). */
  maxMountYawDeg: number;
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
  /** A closure survives "open" readings shorter than this (one noisy frame, T6). */
  closedGapMs: number;
  blinkMaxMs: number;
  slowBlinkMaxMs: number;
  /**
   * Looking down lowers the eyelids (T8). At full down gaze the "closed" line
   * moves down by this much (0.3 → 0.2), so a speedometer or phone glance is
   * not read as closed eyes. Kept small: real closed eyes read ~0–0.12, and
   * closing the eyes can raise the eyeLookDown blendshape (seen on the replay clip).
   */
  downGazeCorrection: number;
  /** Eye "up" value (iris + blendshape, < 0 = down) that counts as full down gaze. */
  downGazeFull: number;
  /**
   * Shaky frames (bumpy road, F06) are not used for most signals, but eyes that
   * are clearly closed (openness below this) still count.
   */
  shakyClosedBelow: number;
}

/**
 * Expressions that close the eyes for a moment: laugh, sneeze, yawn (T9).
 * While one is in progress (or just ended), a microsleep alarm waits `extraMs` longer.
 */
export interface ExpressionConfig {
  /** Fused mouth opening (jaw + MAR, 0–1). */
  mouthAbove: number;
  /**
   * mouthSmile blendshape: above smileAbove AND at least smileRise above the
   * driver's resting smile (calibration). Some faces read 0.9 at rest.
   * Not eyeSquint: closing the eyes raises it too (seen on the replay clip).
   */
  smileAbove: number;
  smileRise: number;
  extraMs: number;
  /** The expression still counts this long after it ends (a sneeze closes the eyes a bit longer). */
  holdMs: number;
}

/** Drowsy eyes that are not fully closed (D01, D02) and near-microsleeps (D09). */
export interface DrowsyEyesConfig {
  /** Heavy lids: openness below this (but not closed), looking ahead, for heavyMs → L1. */
  heavyBelow: number;
  heavyMs: number;
  /**
   * Only with the head near its calibrated pitch: a tilted head shortens the eye
   * in the image and lowers EAR without any drowsiness (C09).
   */
  heavyMaxPitchDeg: number;
  /** Stare: lids lower than usual, no blink, for stareMs, while the head is still sinking (≥ stareSinkDeg over the last stareSinkWindowMs) → L1. */
  stareBelow: number;
  stareMs: number;
  stareSinkDeg: number;
  stareSinkWindowMs: number;
  /** Near-microsleep: a closure of at least nearMissMinMs (but < L1). nearMissCount in the window → L1. */
  nearMissMinMs: number;
  nearMissCount: number;
  nearMissWindowMs: number;
}

/** Blinks getting longer during the trip: an early sign of fatigue (E10). */
export interface BlinkTrendConfig {
  /** The driver's normal blink length is learned in this first part of the trip. */
  baselineMs: number;
  minBaselineBlinks: number;
  recentMs: number;
  minRecentBlinks: number;
  /**
   * Advisory when recent mean blink length ≥ ratio × normal and ≥ minMs. At 15 fps a
   * blink is measured in 67 ms steps, so 2.25 (not 2) keeps one step of noise from
   * counting (150 → 250 ms reads as 133 → 267 ms).
   */
  ratio: number;
  minMs: number;
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
  /**
   * Face lost during a closure with no sign of a head drop (a hand rubbing the
   * eyes, C07): the closure pauses this long, then counts again including the
   * paused time. A fast head drop (T15) skips the pause.
   */
  blindGraceMs: number;
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

/** Default eyes-off-road timing; gaze zones (ZoneConfig) can give a zone its own budget. */
export interface OffRoadConfig {
  d1Ms: number;
  d2Ms: number;
  windowMs: number;
  windowTotalMs: number;
}

/**
 * Gaze zones (docs/ALERT_ACCURACY_PLAN.md, T3). Angles are the combined gaze
 * (head + eyes) relative to the calibrated road ahead: yaw > 0 = right,
 * pitch > 0 = up. Mirror positions assume a left-hand-drive car (Vietnam).
 */
export interface ZoneConfig {
  /** Leave the road zone beyond this yaw… */
  roadYaw: number;
  /** …and come back only inside this one (hysteresis, T6). */
  roadYawReturn: number;
  /** Looking down past this pitch leaves the road zone… */
  downPitch: number;
  /** …and coming back needs this (hysteresis). */
  downPitchReturn: number;
  /** At or above this pitch the driver looks up (signs, lights): still counts as road. */
  upPitch: number;
  /** Degrees of gaze added by the eyes at full deflection (iris / blendshape = ±1). */
  eyeYawDeg: number;
  eyePitchDeg: number;
  /** Below this pitch it is the lap / phone, unless it is the center console. */
  lapPitch: number;
  clusterYaw: number;
  /** [from, to] yaw of the center console (right of the driver). */
  consoleYaw: [number, number];
  /** [from, to] yaw of the rear-view mirror, and the minimum pitch (it is up-right). */
  rearviewYaw: [number, number];
  rearviewPitch: number;
  /** Left mirror: from the road edge out to this yaw (negative). */
  mirrorLeftYaw: number;
  /** [from, to] yaw of the right mirror (far right in a left-hand-drive car). */
  mirrorRightYaw: [number, number];
  /** A new zone must last this long before it counts (debounce, T6). */
  dwellMs: number;
}

/** How long each zone may hold the eyes before D1 (D2 = D1 + escalateMs). */
export interface ZoneBudgetConfig {
  mirrorMs: number;
  rearviewMs: number;
  sideMs: number;
  clusterMs: number;
  consoleMs: number;
  lapMs: number;
  escalateMs: number;
  /** At slow speed, side and mirror looks get at least this long (decision 4). Never phone/lap/console. */
  slowSideMs: number;
  /** Face lost after turning fast to the side (blind-spot / shoulder check). */
  blindSpotMs: number;
}

/**
 * Attention buffer (T4, after AttenD — Kircher & Ahlström 2009). Drains while
 * the eyes are off the road, refills when they come back. Each zone budget
 * (ZoneBudgetConfig) sets the grace before draining (budget > capacity) or a
 * faster drain (budget < capacity). An empty buffer raises D1.
 */
export interface AttentionConfig {
  capacityMs: number;
  /** Back on the road for this long before the buffer refills. */
  refillLatencyMs: number;
  /** Refill speed: buffer ms gained per ms on the road. */
  refillRate: number;
}

/** Face lost right after fast head motion (T15). */
export interface FaceLossConfig {
  /** Look at the head motion over this window just before the face was lost. */
  lookbackMs: number;
  /** Turned away: last head angle beyond this, or turning faster than turnAwayRateDegS (over the lookback). */
  turnAwayYawDeg: number;
  turnAwayRateDegS: number;
  /** Head drop: last head-down angle beyond this, or dropping faster than dropRateDegS. */
  dropDownDeg: number;
  dropRateDegS: number;
}

/** Speed classes from GPS (T1). Below `maneuverBelowKmh` there are no distraction alarms. */
export interface SpeedContextConfig {
  /** Below this: stopped — no alarms at all; resting eyes give an advisory instead. */
  stoppedBelowKmh: number;
  /** Below this: parking / creeping — microsleep alarms only. */
  maneuverBelowKmh: number;
  /** Below this: slow — longer budgets for side and mirror looks. */
  slowBelowKmh: number;
}

/** Motion sensors (T2). */
export interface MotionConfig {
  /** Car turning at least this fast (°/s): looking into the turn is driving. */
  turnRateDegS: number;
  /** …up to this far to the side. */
  turnMaxGazeDeg: number;
  /** …and for at most this long in one go (guard B15: staring out of the window in a long curve). */
  turnMaxMs: number;
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
  /**
   * `(yaw − baseline) × yawRightSign > 0` means "head turned right". +1 is an
   * assumption, like headDownSign: confirm in Debug mode by turning right.
   */
  yawRightSign: 1 | -1;
  /**
   * `gaze.x × gazeXRightSign > 0` means "eyes look right". From the landmark
   * geometry (eye-corner order in features.ts), +x points to the subject's
   * left, so this is −1.
   */
  gazeXRightSign: 1 | -1;
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
  zones: ZoneConfig;
  budgets: ZoneBudgetConfig;
  attention: AttentionConfig;
  faceLoss: FaceLossConfig;
  expression: ExpressionConfig;
  drowsyEyes: DrowsyEyesConfig;
  blinkTrend: BlinkTrendConfig;
  speedContext: SpeedContextConfig;
  motion: MotionConfig;
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
    maxMountYawDeg: 35,
    recalibrateAfterMs: 30 * SECOND,
  },
  eye: {
    earWeight: 0.6,
    closedBelow: 0.3,
    openAbove: 0.6,
    farEyeYawDeg: 25,
    blinkMinMs: 50,
    closedGapMs: 150,
    downGazeCorrection: 0.1,
    downGazeFull: 0.6,
    shakyClosedBelow: 0.15,
    blinkMaxMs: 400,
    slowBlinkMaxMs: 1000,
  },
  microsleep: {
    l1Ms: 1.0 * SECOND,
    l2Ms: 1.5 * SECOND,
    l3Ms: 2.0 * SECOND,
    carryClosureMinMs: 400,
    blindGraceMs: 2 * SECOND,
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
  zones: {
    roadYaw: 30,
    roadYawReturn: 22,
    downPitch: -15,
    downPitchReturn: -10,
    upPitch: 20,
    eyeYawDeg: 30,
    eyePitchDeg: 25,
    lapPitch: -30,
    clusterYaw: 20,
    consoleYaw: [10, 40],
    rearviewYaw: [18, 45],
    rearviewPitch: 8,
    mirrorLeftYaw: -60,
    mirrorRightYaw: [50, 75],
    dwellMs: 150,
  },
  budgets: {
    mirrorMs: 2.5 * SECOND,
    rearviewMs: 3.0 * SECOND,
    sideMs: 2.0 * SECOND,
    clusterMs: 2.0 * SECOND,
    consoleMs: 2.0 * SECOND,
    lapMs: 2.0 * SECOND,
    escalateMs: 1.5 * SECOND,
    slowSideMs: 3.5 * SECOND,
    blindSpotMs: 1.5 * SECOND,
  },
  attention: {
    capacityMs: 2 * SECOND,
    refillLatencyMs: 100,
    refillRate: 1,
  },
  expression: {
    mouthAbove: 0.35,
    smileAbove: 0.5,
    smileRise: 0.3,
    extraMs: 1 * SECOND,
    holdMs: 1 * SECOND,
  },
  drowsyEyes: {
    heavyBelow: 0.55,
    heavyMs: 3 * SECOND,
    heavyMaxPitchDeg: 7,
    stareBelow: 0.7,
    stareMs: 5 * SECOND,
    stareSinkDeg: 2.5,
    stareSinkWindowMs: 3 * SECOND,
    nearMissMinMs: 700,
    nearMissCount: 3,
    nearMissWindowMs: 60 * SECOND,
  },
  blinkTrend: {
    baselineMs: 5 * MINUTE,
    minBaselineBlinks: 20,
    recentMs: 2 * MINUTE,
    minRecentBlinks: 15,
    ratio: 2.25,
    minMs: 250,
  },
  faceLoss: {
    lookbackMs: 300,
    turnAwayYawDeg: 40,
    turnAwayRateDegS: 60,
    dropDownDeg: 20,
    dropRateDegS: 60,
  },
  speedContext: {
    stoppedBelowKmh: 3,
    maneuverBelowKmh: 10,
    slowBelowKmh: 30,
  },
  motion: {
    turnRateDegS: 8,
    turnMaxGazeDeg: 70,
    turnMaxMs: 4 * SECOND,
  },
  pose: {
    headDownSign: -1,
    yawRightSign: 1,
    gazeXRightSign: -1,
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
