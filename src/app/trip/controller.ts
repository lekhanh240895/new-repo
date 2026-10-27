/**
 * Trip controller: wires camera → vision engine → calibration → detectors →
 * state machine, and runs the state machine's effects (SPEC §6, §9–§13).
 *
 * Every device service is injected (TripDeps), so the whole flow — including
 * faults — is tested in Node with fakes (controller.test.ts).
 */
import { computeBaseline, fallbackBaseline, type Baseline, type CalibrationFailure } from '../../core/calibration/baseline.ts'
import { mountTooFarToSide } from '../../core/calibration/mount.ts'
import { DEFAULT_CONFIG, type Config } from '../../core/config.ts'
import { createSignalPipeline, type SignalDebug, type SignalPipeline } from '../../core/detectors/pipeline.ts'
import { alertRank, createSession, hudStatus, reduce, type HudStatus } from '../../core/fsm/index.ts'
import type { AlarmLevel, Effect, FaultReason, SessionEvent, SessionState } from '../../core/fsm/types.ts'
import { createQualityTracker } from '../../core/signals/quality.ts'
import { createSignalSmoother } from '../../core/signals/smoothing.ts'
import type { FrameResult, ProcessedFrame } from '../../core/types.ts'
import type { AudioEngine, VoiceLang } from '../../platform/audio.ts'
import { CameraError, type CameraHandle, type CameraOptions } from '../../platform/camera.ts'
import type { ScreenWakeLock, VibrationKind } from '../../platform/device.ts'
import type { FrameLoop, FrameLoopOptions } from '../../platform/frameLoop.ts'
import type { MotionMonitor } from '../../platform/motion.ts'
import type { SpeedMonitor } from '../../platform/speed.ts'
import type { Watchdog } from '../../platform/watchdog.ts'
import type { Backend, EngineOptions, VisionEngine } from '../../vision/engine.ts'

export interface TripDeps {
  openCamera(video: HTMLVideoElement, opts: CameraOptions): Promise<CameraHandle>;
  startEngine(opts: EngineOptions): Promise<VisionEngine>;
  startFrameLoop(opts: FrameLoopOptions): FrameLoop;
  audio: AudioEngine;
  wakeLock: ScreenWakeLock;
  vibrate(level: VibrationKind): void;
  watchVisibility(onChange: (hidden: boolean) => void): () => void;
  startSpeedMonitor(armAboveKmh: number): SpeedMonitor;
  watchdog: Watchdog;
  now(): number;
  /** Optional: battery updates (Chromium only). Returns an unsubscribe function. */
  watchBattery?(onChange: (state: BatteryState) => void): () => void;
  /** Optional: a system notification, because sound may not play while the page is hidden. */
  notify?(kind: 'paused'): void;
  /** Optional: motion sensors (turn rate, "still"). Plan T2. */
  startMotionMonitor?(): MotionMonitor;
}

export interface BatteryState {
  /** 0–1 */
  level: number;
  charging: boolean;
}

const BATTERY_LOW = 0.15

export interface TripOptions {
  /** Ask for location so alarms stay quiet when the car is stopped (SPEC §10.6). */
  useLocation: boolean;
  /** Force the CPU model / main-thread fallback (Debug switches). */
  preferGpu?: boolean;
  preferWorker?: boolean;
  /** Show a notification when monitoring pauses because the app was hidden (SPEC §12 F10). */
  notifyWhenPaused?: boolean;
  /** Use the motion sensors to recognize turns and stops (decision 3: on by default). */
  useMotion?: boolean;
  /** Config for this trip (the driver's personal adaptation, T12). Default: the controller's config. */
  config?: Config;
}

/** One alarm episode of the trip, for the summary ("was this a false alarm?", T12). */
export interface AlertRecord {
  id: number;
  /** Seconds since the trip started. */
  atSec: number;
  /** D = eyes off road, L = microsleep / drowsy eyes. From the episode's first alarm. */
  family: 'D' | 'L';
  /** Highest level reached in the episode. */
  level: AlarmLevel;
}

export interface SetupStatus {
  faceSeen: boolean;
  lightOk: boolean;
  sizeOk: boolean;
  /** What to fix, when setup is slow or failed. */
  hint: SetupHint | null;
}

export interface CalibrationStatus {
  attempt: number;
  progress: number;
  /** Why the last attempt was rejected. */
  retryReason: CalibrationFailure | null;
  approximate: boolean;
}

export interface TripSnapshot {
  session: SessionState;
  hud: HudStatus;
  backend: Backend | null;
  frameWidth: number;
  setup: SetupStatus;
  calibration: CalibrationStatus;
  /** Latest detector numbers (throttled). */
  debug: SignalDebug | null;
  audioReady: boolean;
  wakeLockActive: boolean;
  speedKmh: number | null;
  /** For a setup FAULT: what to fix. */
  faultHint: SetupHint | null;
  /** Technical detail for a FAULT (not translated; shown small). */
  faultDetail: string | null;
  /** Recovery attempts are used up: the driver must restart the trip. */
  faultGaveUp: boolean;
  /** Battery under 15% and not charging (SPEC §12 F18). */
  batteryLow: boolean;
  /** Calibration shows the phone is mounted far to the side (plan A23). */
  mountWarning: boolean;
  needsRecalibration: boolean;
  recalibrating: boolean;
  /** Alarm episodes of this trip (at most ALERT_LOG_SIZE). */
  alerts: readonly AlertRecord[];
  log: readonly string[];
}

export interface TripController {
  getSnapshot(): TripSnapshot;
  subscribe(listener: () => void): () => void;
  /** Call from the "Start trip" tap: audio, camera and wake lock need a user gesture. */
  start(video: HTMLVideoElement, options: TripOptions): void;
  endTrip(): void;
  reset(): void;
  ackAwake(): void;
  /** Try again after a fault. */
  retry(): void;
  /** Learn a new baseline in the background while monitoring continues. */
  recalibrate(): void;
  /** Voice language for alerts. */
  setLanguage(lang: VoiceLang): void;
  /** Stop all devices and return to IDLE. The controller can be started again. */
  dispose(): void;
}

/** What to fix during setup. The UI turns these into text in the current language. */
export type SetupHint = 'noFace' | 'dark' | 'bright' | 'small'

const SNAPSHOT_THROTTLE_MS = 250
/** Delegate benchmark: skip warm-up frames, and decide early when the GPU is clearly slow. */
const TUNE_WARMUP_FRAMES = 3
const TUNE_EARLY_FRAMES = 10
const LOG_SIZE = 50
const ALERT_LOG_SIZE = 50
/** Consecutive failed frames that count as a stall. */
const MAX_FRAME_ERRORS = 15

/** The snapshot before any trip (also used while the controller is being created). */
export function initialTripSnapshot(cfg: Config = DEFAULT_CONFIG, s: SessionState = createSession()): TripSnapshot {
  return {
    session: s,
    hud: hudStatus(s),
    backend: null,
    frameWidth: cfg.performance.normalWidth,
    setup: { faceSeen: false, lightOk: false, sizeOk: false, hint: null },
    calibration: { attempt: 0, progress: 0, retryReason: null, approximate: false },
    debug: null,
    audioReady: false,
    wakeLockActive: false,
    speedKmh: null,
    faultHint: null,
    faultDetail: null,
    faultGaveUp: false,
    batteryLow: false,
    mountWarning: false,
    needsRecalibration: false,
    recalibrating: false,
    alerts: [],
    log: [],
  }
}


export function createTripController(deps: TripDeps, baseCfg: Config = DEFAULT_CONFIG): TripController {
  // Each trip may bring its own config (personal adaptation, T12); see start().
  let cfg = baseCfg
  const listeners = new Set<() => void>()
  let session = createSession()
  let snap: TripSnapshot = initialTripSnapshot(cfg, session)

  let video: HTMLVideoElement | null = null
  let options: TripOptions = { useLocation: false }
  let camera: CameraHandle | null = null
  let engine: VisionEngine | null = null
  let loop: FrameLoop | null = null
  let speed: SpeedMonitor | null = null
  let motion: MotionMonitor | null = null
  let stopVisibility: (() => void) | null = null
  let stopBattery: (() => void) | null = null
  let batteryWarned = false

  let smoother = createSignalSmoother()
  let quality = createQualityTracker(cfg.quality)
  let pipeline: SignalPipeline | null = null
  let baseline: Baseline | null = null
  let frameWidth = cfg.performance.normalWidth

  // Phase-specific working state.
  let setupStart: number | null = null
  let setupOkSince: number | null = null
  let calibFrames: ProcessedFrame[] = []
  let calibStart: number | null = null
  let calibAttempt = 0
  let recalibFrames: ProcessedFrame[] | null = null
  let restarts = 0
  let frameErrors = 0
  let lowFpsSince: number | null = null
  let lastDebugPush = -Infinity
  let busyRecovering = false
  /** Delegate auto-tune (SPEC §17.1): measure GPU, maybe try CPU, keep the faster. */
  let tune: { phase: 'measure-gpu' | 'measure-cpu' | 'done'; seen: number; gpuMs: number[]; cpuMs: number[] } = {
    phase: 'done',
    seen: 0,
    gpuMs: [],
    cpuMs: [],
  }

  function publish(patch: Partial<TripSnapshot>) {
    snap = { ...snap, ...patch, session, hud: hudStatus(session) }
    for (const l of listeners) l()
  }

  function log(message: string) {
    console.info(`BioMonitor: ${message}`)
    publish({ log: [...snap.log.slice(-(LOG_SIZE - 1)), message] })
  }

  /** Speak the battery warning once per trip, only while monitoring. */
  function warnBatteryIfNeeded() {
    if (snap.batteryLow && !batteryWarned && session.phase === 'MONITORING') {
      batteryWarned = true
      deps.audio.speak('batteryLow')
      log('battery low and not charging')
    }
  }

  // ---------------------------------------------------------------- dispatch

  function dispatch(event: SessionEvent) {
    const prevPhase = session.phase
    const r = reduce(session, event, cfg)
    session = r.state
    for (const e of r.effects) runEffect(e)
    if (session.phase !== prevPhase) onPhaseChange(prevPhase)
    publish({})
  }

  let alarmActive = false
  /** A new alarm episode, or a higher level in the current one. */
  function recordAlarm(level: AlarmLevel) {
    const alerts = snap.alerts
    const last = alerts[alerts.length - 1]
    if (alarmActive && last !== undefined) {
      if (alertRank(level) > alertRank(last.level)) publish({ alerts: [...alerts.slice(0, -1), { ...last, level }] })
      return
    }
    alarmActive = true
    if (alerts.length >= ALERT_LOG_SIZE) return
    const startedAt = session.tripStartedAt ?? deps.now()
    const record: AlertRecord = {
      id: (last?.id ?? 0) + 1,
      atSec: Math.max(0, Math.round((deps.now() - startedAt) / 1000)),
      family: level.startsWith('D') ? 'D' : 'L',
      level,
    }
    publish({ alerts: [...alerts, record] })
  }

  function runEffect(e: Effect) {
    switch (e.type) {
      case 'unlockAudio':
        publish({ audioReady: deps.audio.unlock() && deps.audio.isReady() })
        return
      case 'requestWakeLock':
        void deps.wakeLock.request().then((ok) => {
          publish({ wakeLockActive: ok })
          if (!ok) log('wake lock not available — keep the screen on manually')
        })
        return
      case 'releaseWakeLock':
        void deps.wakeLock.release().then(() => publish({ wakeLockActive: false }))
        return
      case 'startCamera':
        void boot()
        return
      case 'stopCamera':
        teardown()
        return
      case 'alarm':
        recordAlarm(e.level)
        deps.audio.startAlarm(e.level)
        deps.vibrate(e.level)
        publish({ audioReady: deps.audio.isReady() })
        return
      case 'alarmStop':
        alarmActive = false
        deps.audio.stopAlarm()
        deps.vibrate('stop')
        return
      case 'speak':
        deps.audio.speak(e.message)
        if (e.message === 'fatigueAdvisory' || e.message === 'fatigueStrong') deps.vibrate('advisory')
        return
      case 'chime':
        deps.audio.chime(e.kind)
        return
      case 'log':
        log(e.message)
        return
    }
  }

  function onPhaseChange(prev: SessionState['phase']) {
    const t = deps.now()
    switch (session.phase) {
      case 'SETUP_CHECK':
        setupStart = t
        setupOkSince = null
        // Test tone: the driver should hear it; if not, they turn the volume up (SPEC §11).
        deps.audio.chime('test')
        publish({ setup: { faceSeen: false, lightOk: false, sizeOk: false, hint: null } })
        return
      case 'CALIBRATING':
        startCalibration(1)
        return
      case 'MONITORING':
        if (prev === 'SUSPENDED' || prev === 'FAULT') quality.reset()
        warnBatteryIfNeeded()
        return
      case 'SUMMARY':
      case 'IDLE':
        return
      default:
        return
    }
  }

  // ---------------------------------------------------------------- pipeline lifecycle

  /** After an await: the trip may have been ended or reset meanwhile. */
  function cancelled(): boolean {
    return session.phase === 'SUMMARY' || session.phase === 'IDLE'
  }

  async function boot() {
    const v = video
    if (v === null) return
    try {
      camera = await deps.openCamera(v, { onEnded: () => void onCameraLost() })
    } catch (err) {
      if (cancelled()) return
      if (err instanceof CameraError && err.kind === 'denied') {
        dispatch({ type: 'PERMISSIONS_DENIED', t: deps.now() })
      } else {
        faultWith('CAMERA_LOST', err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (cancelled()) {
      teardown()
      return
    }
    dispatch({ type: 'PERMISSIONS_GRANTED', t: deps.now() })
    if (options.useLocation) speed = deps.startSpeedMonitor(cfg.speed.armAboveKmh)
    if (options.useMotion !== false && deps.startMotionMonitor) motion = deps.startMotionMonitor()

    const engineOk = await startEngine(options.preferGpu ?? true)
    if (cancelled()) {
      teardown()
      return
    }
    if (!engineOk) {
      dispatch({ type: 'MODEL_FAILED', t: deps.now() })
      return
    }
    dispatch({ type: 'MODEL_READY', t: deps.now() })
    startLoop()
  }

  async function startEngine(preferGpu: boolean): Promise<boolean> {
    try {
      engine?.dispose()
      engine = await deps.startEngine({
        preferGpu,
        preferWorker: options.preferWorker ?? true,
        onFatal: (err) => void onStall(err.message),
      })
      tune =
        engine.backend.endsWith('gpu') && preferGpu && tune.phase === 'done' && tune.gpuMs.length === 0
          ? { phase: 'measure-gpu', seen: 0, gpuMs: [], cpuMs: [] }
          : tune
      publish({ backend: engine.backend })
      log(`vision backend: ${engine.backend}`)
      return true
    } catch (err) {
      engine = null
      log(`vision engine failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  function startLoop() {
    const v = video
    if (v === null || loop !== null) return
    loop = deps.startFrameLoop({
      video: v,
      targetFps: cfg.performance.targetFps,
      width: frameWidth,
      onFrame: handleFrame,
      onError: (err) => onFrameError(err),
    })
    deps.watchdog.start(() => void onStall('no frames for too long'), deps.now)
  }

  function stopLoop() {
    loop?.stop()
    loop = null
    deps.watchdog.stop()
  }

  function teardown() {
    stopLoop()
    engine?.dispose()
    engine = null
    camera?.stop()
    camera = null
    speed?.stop()
    speed = null
    motion?.stop()
    motion = null
  }

  function faultWith(reason: FaultReason, detail?: string) {
    dispatch({ type: 'FAULT', t: deps.now(), reason })
    publish({ faultDetail: detail ?? null })
  }

  // ---------------------------------------------------------------- faults & recovery

  async function onCameraLost() {
    if (busyRecovering || session.phase === 'SUMMARY' || session.phase === 'IDLE') return
    camera = null
    stopLoop()
    faultWith('CAMERA_LOST')
    await recoverCamera()
  }

  async function recoverCamera(): Promise<boolean> {
    const v = video
    if (v === null) return false
    busyRecovering = true
    try {
      camera?.stop()
      camera = await deps.openCamera(v, { onEnded: () => void onCameraLost() })
      if (cancelled()) {
        teardown()
        return false
      }
      startLoop()
      dispatch({ type: 'RECOVERED', t: deps.now() })
      publish({ faultHint: null, faultDetail: null, faultGaveUp: false })
      return true
    } catch (err) {
      log(`camera recovery failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      busyRecovering = false
    }
  }

  async function onStall(detail: string) {
    if (busyRecovering) return
    const phase = session.phase
    if (phase !== 'SETUP_CHECK' && phase !== 'CALIBRATING' && phase !== 'MONITORING') return
    stopLoop()
    faultWith('WORKER_STALLED', detail)
    await restartEngine()
  }

  async function restartEngine(): Promise<boolean> {
    busyRecovering = true
    try {
      while (restarts < cfg.watchdog.maxRestarts) {
        restarts++
        log(`restarting vision engine (attempt ${restarts})`)
        const ok = await startEngine(engine?.backend.endsWith('gpu') ?? (options.preferGpu ?? true))
        if (cancelled()) {
          teardown()
          return false
        }
        if (ok) {
          frameErrors = 0
          startLoop()
          dispatch({ type: 'RECOVERED', t: deps.now() })
          publish({ faultHint: null, faultDetail: null, faultGaveUp: false })
          return true
        }
      }
      publish({ faultGaveUp: true })
      return false
    } finally {
      busyRecovering = false
    }
  }

  function onFrameError(err: Error) {
    frameErrors++
    if (frameErrors === 1) log(`frame failed: ${err.message}`)
    if (frameErrors >= MAX_FRAME_ERRORS) void onStall(`${frameErrors} frames failed: ${err.message}`)
  }

  // ---------------------------------------------------------------- frames

  async function handleFrame(image: ImageBitmap, t: number) {
    const e = engine
    if (e === null) {
      image.close()
      return
    }
    const raw = await e.process(image, t, false, baseline?.faceCenter ?? null)
    if (cancelled()) return
    frameErrors = 0
    deps.watchdog.kick(deps.now())
    const q = quality.update(raw)
    const frame: ProcessedFrame = { raw, smooth: smoother.smooth(raw), ...q }
    await tuneDelegate(raw)
    adaptResolution(frame)

    switch (session.phase) {
      case 'SETUP_CHECK':
        onSetupFrame(frame)
        return
      case 'CALIBRATING':
        onCalibrationFrame(frame)
        return
      case 'MONITORING':
        onMonitoringFrame(frame)
        return
      default:
        return
    }
  }

  async function tuneDelegate(raw: FrameResult) {
    if (tune.phase === 'done') return
    const p = cfg.performance
    // The first frames of any engine are slow (warm-up); do not count them.
    tune.seen++
    if (tune.seen <= TUNE_WARMUP_FRAMES) return
    if (tune.phase === 'measure-gpu') {
      tune.gpuMs.push(raw.inferMs)
      const gpu = mean(tune.gpuMs)
      // Clearly slow after a few frames: decide now instead of making setup wait.
      const clearlySlow = tune.gpuMs.length >= TUNE_EARLY_FRAMES && gpu > 2 * p.gpuSlowMs
      if (!clearlySlow && tune.gpuMs.length < p.tuneFrames) return
      if (gpu <= p.gpuSlowMs) {
        tune = { ...tune, phase: 'done' }
        return
      }
      log(`GPU is slow (${gpu.toFixed(0)} ms/frame), trying CPU`)
      tune = { ...tune, phase: 'measure-cpu', seen: 0 }
      await swapEngine(false)
    } else {
      tune.cpuMs.push(raw.inferMs)
      if (tune.cpuMs.length < Math.min(p.tuneFrames, Math.max(TUNE_EARLY_FRAMES, tune.gpuMs.length))) return
      const gpu = mean(tune.gpuMs)
      const cpu = mean(tune.cpuMs)
      tune = { ...tune, phase: 'done' }
      log(`delegate benchmark: GPU ${gpu.toFixed(0)} ms, CPU ${cpu.toFixed(0)} ms`)
      if (gpu < cpu) await swapEngine(true)
    }
  }

  /** Replace the engine without raising a fault (the watchdog pauses meanwhile). */
  async function swapEngine(preferGpu: boolean) {
    deps.watchdog.stop()
    busyRecovering = true
    try {
      const ok = await startEngine(preferGpu)
      if (!ok) await startEngine(!preferGpu)
      // fps measured across the swap is meaningless.
      quality.reset()
      lowFpsSince = null
    } finally {
      busyRecovering = false
      deps.watchdog.start(() => void onStall('no frames for too long'), deps.now)
    }
  }

  function adaptResolution(frame: ProcessedFrame) {
    const p = cfg.performance
    // While benchmarking, low fps says nothing about the delegate we will keep.
    if (tune.phase !== 'done') {
      lowFpsSince = null
      return
    }
    if (frameWidth === p.lowWidth || frame.fps === 0) return
    lowFpsSince = frame.fps < p.lowFpsBelow ? (lowFpsSince ?? frame.raw.t) : null
    if (lowFpsSince !== null && frame.raw.t - lowFpsSince >= p.lowForMs) {
      frameWidth = p.lowWidth
      loop?.setWidth(frameWidth)
      log(`device is slow (${frame.fps.toFixed(1)} fps): lowering resolution to ${frameWidth} px`)
      publish({ frameWidth })
    }
  }

  function onSetupFrame(frame: ProcessedFrame) {
    const t = frame.raw.t
    const q = frame.raw.quality
    const faceSeen = frame.raw.faceFound
    const lightOk = q.faceLuma >= cfg.quality.minFaceLuma && q.faceLuma <= cfg.quality.maxFaceLuma
    const sizeOk = !faceSeen || q.faceAreaRatio >= cfg.quality.minFaceAreaRatio
    const good = faceSeen && lightOk && sizeOk && frame.frameValid && tune.phase === 'done'
    setupOkSince = good ? (setupOkSince ?? t) : null
    const hint: SetupHint | null = !faceSeen
      ? (q.faceLuma < cfg.quality.minFaceLuma ? 'dark' : 'noFace')
      : !lightOk
        ? (q.faceLuma < cfg.quality.minFaceLuma ? 'dark' : 'bright')
        : !sizeOk
          ? 'small'
          : null

    const start = setupStart ?? t
    if (setupOkSince !== null && t - setupOkSince >= cfg.setup.okForMs) {
      publish({ setup: { faceSeen, lightOk, sizeOk, hint: null } })
      dispatch({ type: 'SETUP_PASSED', t })
    } else if (t - start >= cfg.setup.timeoutMs) {
      publish({ setup: { faceSeen, lightOk, sizeOk, hint } })
      dispatch({ type: 'SETUP_FAILED', t })
      publish({ faultHint: hint })
    } else {
      // Show hints only after a moment, so they do not flash while the camera settles.
      publish({ setup: { faceSeen, lightOk, sizeOk, hint: t - start > 3000 ? hint : null } })
    }
  }

  function startCalibration(attempt: number) {
    calibAttempt = attempt
    calibFrames = []
    calibStart = null
    deps.audio.speak('calibrate')
    publish({ calibration: { ...snap.calibration, attempt, progress: 0 } })
  }

  function onCalibrationFrame(frame: ProcessedFrame) {
    const t = frame.raw.t
    calibStart ??= t
    calibFrames.push(frame)
    const progress = Math.min(1, (t - calibStart) / cfg.calibration.durationMs)
    if (progress < 1) {
      if (calibFrames.length % 5 === 0) publish({ calibration: { ...snap.calibration, progress } })
      return
    }
    const result = computeBaseline(calibFrames, cfg.calibration)
    if (!result.ok && calibAttempt < cfg.calibration.maxAttempts) {
      log(`calibration attempt ${calibAttempt} rejected: ${result.reason}`)
      publish({ calibration: { ...snap.calibration, retryReason: result.reason } })
      startCalibration(calibAttempt + 1)
      return
    }
    applyBaseline(fallbackBaseline(result))
    if (!result.ok) log(`calibration incomplete (${result.reason}): using approximate values`)
    dispatch({ type: 'CALIBRATION_DONE', t })
  }

  function applyBaseline(b: Baseline) {
    baseline = b
    quality.setBaselineJitter(b.jitter)
    pipeline = createSignalPipeline(cfg, b)
    const mountWarning = !b.approximate && mountTooFarToSide(b, cfg.calibration)
    if (mountWarning) log(`phone mounted ${Math.abs(b.yawDeg).toFixed(0)}° to the side`)
    publish({
      calibration: { ...snap.calibration, progress: 1, approximate: b.approximate },
      needsRecalibration: false,
      mountWarning,
    })
  }

  function onMonitoringFrame(frame: ProcessedFrame) {
    const p = pipeline
    if (p === null) return
    const out = p.update(frame, {
      armed: speed?.armed() ?? true,
      alarmActive: session.monitoring.latched !== null,
      // With location on, the speed decides (null = no GPS fix = moving); without it, always armed.
      ...(speed !== null && { speedKmh: speed.speedKmh() }),
      ...(motion !== null && { motion: motion.state() }),
    })
    dispatch({ type: 'FRAME', signals: out.signals })

    if (recalibFrames !== null) {
      recalibFrames.push(frame)
      const first = recalibFrames[0]?.raw.t ?? frame.raw.t
      if (frame.raw.t - first >= cfg.calibration.durationMs) {
        const r = computeBaseline(recalibFrames, cfg.calibration)
        recalibFrames = null
        if (r.ok) {
          applyBaseline(r.baseline)
          log('re-calibrated')
        } else {
          log(`re-calibration rejected: ${r.reason}`)
        }
        publish({ recalibrating: false })
      }
    }

    const now = frame.raw.t
    if (now - lastDebugPush >= SNAPSHOT_THROTTLE_MS) {
      lastDebugPush = now
      publish({ debug: out.debug, needsRecalibration: out.debug.needsRecalibration, speedKmh: speed?.speedKmh() ?? null })
    }
  }

  // ---------------------------------------------------------------- public API

  return {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start(v, opts) {
      if (session.phase !== 'IDLE') return
      video = v
      options = opts
      cfg = opts.config ?? baseCfg
      alarmActive = false
      publish({ alerts: [] })
      restarts = 0
      frameWidth = cfg.performance.normalWidth
      smoother = createSignalSmoother()
      quality = createQualityTracker(cfg.quality)
      pipeline = null
      baseline = null
      tune = { phase: 'done', seen: 0, gpuMs: [], cpuMs: [] }
      batteryWarned = false
      stopBattery ??=
        deps.watchBattery?.((b) => {
          const low = b.level < BATTERY_LOW && !b.charging
          if (low !== snap.batteryLow) publish({ batteryLow: low })
          warnBatteryIfNeeded()
        }) ?? null
      stopVisibility ??= deps.watchVisibility((hidden) => {
        if (hidden) {
          if (options.notifyWhenPaused && session.phase === 'MONITORING') deps.notify?.('paused')
          deps.watchdog.stop()
          dispatch({ type: 'PAGE_HIDDEN', t: deps.now() })
        } else {
          dispatch({ type: 'PAGE_VISIBLE', t: deps.now() })
          if (camera === null || !camera.stream.getVideoTracks().some((tr) => tr.readyState === 'live')) {
            void onCameraLost()
          } else if (loop !== null) {
            deps.watchdog.start(() => void onStall('no frames for too long'), deps.now)
          }
        }
      })
      // Unlock audio synchronously, inside the tap (SPEC §12 F8).
      dispatch({ type: 'START', t: deps.now() })
    },
    endTrip() {
      recalibFrames = null
      dispatch({ type: 'END_TRIP', t: deps.now() })
    },
    reset() {
      teardown()
      dispatch({ type: 'RESET', t: deps.now() })
      snap = initialTripSnapshot(cfg, session)
      publish({})
    },
    ackAwake() {
      dispatch({ type: 'ACK_AWAKE', t: deps.now() })
    },
    retry() {
      if (session.phase !== 'FAULT') return
      const reason = session.fault
      if (reason === 'CAMERA_DENIED' || session.resumeTo === null) {
        teardown()
        dispatch({ type: 'RESET', t: deps.now() })
        return
      }
      if (reason === 'SETUP_FAILED') {
        dispatch({ type: 'RECOVERED', t: deps.now() })
        publish({ faultHint: null, faultDetail: null, faultGaveUp: false })
        return
      }
      if (reason === 'CAMERA_LOST') {
        if (session.resumeTo === 'PERMISSIONS') {
          dispatch({ type: 'RECOVERED', t: deps.now() })
          void boot()
        } else void recoverCamera()
        return
      }
      if (reason === 'MODEL_FAILED') {
        void startEngine(options.preferGpu ?? true).then((ok) => {
          if (!ok) return
          dispatch({ type: 'RECOVERED', t: deps.now() })
          dispatch({ type: 'MODEL_READY', t: deps.now() })
          publish({ faultHint: null, faultDetail: null, faultGaveUp: false })
          startLoop()
        })
        return
      }
      restarts = 0
      void restartEngine()
    },
    setLanguage(lang) {
      deps.audio.setLanguage(lang)
    },
    recalibrate() {
      if (session.phase !== 'MONITORING' || recalibFrames !== null) return
      recalibFrames = []
      deps.audio.speak('calibrate')
      publish({ recalibrating: true })
    },
    dispose() {
      // Releases devices only. Subscriptions are owned by the subscribers, so a
      // disposed controller can be started again (React StrictMode remounts).
      teardown()
      stopVisibility?.()
      stopVisibility = null
      stopBattery?.()
      stopBattery = null
      deps.audio.dispose()
      if (session.phase !== 'IDLE') {
        session = createSession()
        snap = initialTripSnapshot(cfg, session)
        publish({})
      }
    },
  }
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length
}
