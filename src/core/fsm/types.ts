import type { FatigueLevel, FrameSignals, SensorState } from '../types.ts'

/** Alarm levels that latch until the driver recovers (SPEC §11). */
export type AlarmLevel = 'D1' | 'L1' | 'D2' | 'L2' | 'L3'

/** Everything the driver can be told, highest priority last (SPEC §13.2). */
export type AlertLevel = 'NONE' | 'ADVISORY' | 'STRONG_ADVISORY' | AlarmLevel

export const ALERT_PRIORITY: readonly AlertLevel[] = [
  'NONE',
  'ADVISORY',
  'STRONG_ADVISORY',
  'D1',
  'L1',
  'D2',
  'L2',
  'L3',
]

export type SpokenMessage =
  | 'fatigueAdvisory'
  | 'fatigueStrong'
  | 'takeBreak'
  | 'eyesHidden'

export type ChimeKind = 'monitoringOff' | 'paused'

/** Side effects the platform layer must run. The reducer itself never touches the DOM. */
export type Effect =
  | { type: 'unlockAudio' }
  | { type: 'requestWakeLock' }
  | { type: 'releaseWakeLock' }
  | { type: 'startCamera' }
  | { type: 'stopCamera' }
  | { type: 'alarm'; level: AlarmLevel }
  | { type: 'alarmStop' }
  | { type: 'speak'; message: SpokenMessage }
  | { type: 'chime'; kind: ChimeKind }
  | { type: 'log'; message: string }

export interface TripStats {
  /** How many times each alarm level was reached. */
  alarms: Record<AlarmLevel, number>;
  longestClosureMs: number;
}

/** Timers and latches used while MONITORING. */
export interface MonitoringState {
  lastT: number | null;
  sensor: SensorState;
  closedSince: number | null;
  /** Eyes read "open" since this time, inside a closure (a short gap keeps the closure going). */
  openSince: number | null;
  /** Eyes closed while stopped (no alarms then): for the "resting eyes" advisory. */
  restClosedSince: number | null;
  offRoadSince: number | null;
  /** Attention buffer in ms (T4). null = full (attention.capacityMs). */
  buffer: number | null;
  /** Start of the current off-road glance, and its zone (a new zone = a new glance with its own grace). */
  glanceStart: number | null;
  glanceZone: string | null;
  /** Back on the road since (for the refill latency). */
  onRoadSince: number | null;
  /** Buffer empty since (D1); D2 follows after the escalation time. */
  emptySince: number | null;
  /** Off-road time per frame inside the sliding window. */
  offRoadLog: readonly { t: number; dt: number }[];
  recoveredSince: number | null;
  /** When the camera stopped seeing the driver. */
  blindSince: number | null;
  lastMonitoringOffChimeAt: number | null;
  /** The alarm that is latched until recovery. */
  latched: AlarmLevel | null;
  /** What the driver is told right now. */
  alert: AlertLevel;
  fatigue: FatigueLevel;
  strongShiftUntil: number | null;
  postAlarmAdvisoryUntil: number | null;
  lastAdvisorySpokenAt: number | null;
  lastStrongSpokenAt: number | null;
  stats: TripStats;
}

export type Phase =
  | 'IDLE'
  | 'PERMISSIONS'
  | 'LOADING'
  | 'SETUP_CHECK'
  | 'CALIBRATING'
  | 'MONITORING'
  | 'SUSPENDED'
  | 'FAULT'
  | 'SUMMARY'

/** Phases a SUSPENDED or FAULT session can go back to. */
export type RunningPhase = 'PERMISSIONS' | 'LOADING' | 'SETUP_CHECK' | 'CALIBRATING' | 'MONITORING'

export type FaultReason =
  | 'CAMERA_DENIED'
  | 'CAMERA_LOST'
  | 'MODEL_FAILED'
  | 'WORKER_STALLED'
  | 'AUDIO_BLOCKED'
  | 'SETUP_FAILED'

export interface SessionState {
  phase: Phase;
  /** Where to go back to after SUSPENDED or a recoverable FAULT. */
  resumeTo: RunningPhase | null;
  fault: FaultReason | null;
  tripStartedAt: number | null;
  tripEndedAt: number | null;
  monitoring: MonitoringState;
}

export type SessionEvent =
  | { type: 'START'; t: number }
  | { type: 'PERMISSIONS_GRANTED'; t: number }
  | { type: 'PERMISSIONS_DENIED'; t: number }
  | { type: 'MODEL_READY'; t: number }
  | { type: 'MODEL_FAILED'; t: number }
  | { type: 'SETUP_PASSED'; t: number }
  | { type: 'SETUP_FAILED'; t: number }
  | { type: 'CALIBRATION_DONE'; t: number }
  | { type: 'FRAME'; signals: FrameSignals }
  | { type: 'ACK_AWAKE'; t: number }
  | { type: 'PAGE_HIDDEN'; t: number }
  | { type: 'PAGE_VISIBLE'; t: number }
  | { type: 'FAULT'; t: number; reason: FaultReason }
  | { type: 'RECOVERED'; t: number }
  | { type: 'END_TRIP'; t: number }
  | { type: 'RESET'; t: number }

export interface Transition<S> {
  state: S;
  effects: Effect[];
}
