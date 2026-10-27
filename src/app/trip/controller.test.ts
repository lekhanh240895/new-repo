/**
 * Trip controller tests with fake devices: the full flow from "Start trip"
 * to alarms, and the failure modes F7–F10, F16, F19, F20 (SPEC §12).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import type { FrameResult } from '../../core/types.ts'
import type { AudioEngine } from '../../platform/audio.ts'
import { CameraError, type CameraOptions } from '../../platform/camera.ts'
import type { FrameLoopOptions } from '../../platform/frameLoop.ts'
import { createWatchdog } from '../../platform/watchdog.ts'
import { processed, type FrameSpec } from '../../test/frames.ts'
import type { EngineOptions } from '../../vision/engine.ts'
import { createTripController, type TripDeps } from './controller.ts'

const SETUP_MS = 4000

type Spec = FrameSpec & { inferMs?: number; luma?: number; area?: number }

function rawFrame(t: number, spec: Spec): FrameResult {
  const r = processed(t, spec).raw
  return {
    ...r,
    inferMs: spec.inferMs ?? 20,
    quality: { ...r.quality, faceLuma: spec.luma ?? r.quality.faceLuma, faceAreaRatio: spec.area ?? r.quality.faceAreaRatio },
  }
}

function harness(opts: { gpu?: boolean; cameraError?: CameraError; engineFails?: boolean } = {}) {
  const calls: string[] = []
  let clock = 0
  let spec: Spec = {}
  let onFrame: FrameLoopOptions['onFrame'] | null = null
  let onCameraEnded: (() => void) | null = null
  let visibility: ((hidden: boolean) => void) | null = null
  let onStall: (() => void) | null = null
  let armed = true
  let battery: ((b: { level: number; charging: boolean }) => void) | null = null
  let turnRate: number | null = 0
  const preferArgs: ({ x: number; y: number } | null | undefined)[] = []
  const realDog = createWatchdog(DEFAULT_CONFIG.watchdog.stallMs, DEFAULT_CONFIG.watchdog.startupMs)

  const audio: AudioEngine = {
    unlock: () => (calls.push('audio.unlock'), true),
    isReady: () => true,
    startAlarm: (l) => void calls.push(`alarm:${l}`),
    stopAlarm: () => void calls.push('alarmStop'),
    chime: (k) => void calls.push(`chime:${k}`),
    speak: (m) => void calls.push(`speak:${m}`),
    setLanguage: (l) => void calls.push(`lang:${l}`),
    dispose: () => {},
  }

  const deps: TripDeps = {
    async openCamera(_v, o: CameraOptions) {
      calls.push('camera.open')
      if (opts.cameraError) throw opts.cameraError
      onCameraEnded = o.onEnded ?? null
      return {
        stream: { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream,
        stop: () => void calls.push('camera.stop'),
      }
    },
    async startEngine(o: EngineOptions) {
      calls.push(`engine.start:${o.preferGpu === false ? 'cpu' : 'gpu'}`)
      if (opts.engineFails) throw new Error('no wasm')
      const gpu = o.preferGpu !== false && opts.gpu !== false
      return {
        backend: gpu ? 'worker-gpu' : 'worker-cpu',
        async process(image, t, _d, prefer) {
          image.close()
          preferArgs.push(prefer)
          return rawFrame(t, { ...spec, inferMs: gpu ? (spec.inferMs ?? 20) : 20 })
        },
        dispose: () => void calls.push('engine.dispose'),
      }
    },
    startFrameLoop(o) {
      calls.push('loop.start')
      onFrame = o.onFrame
      return {
        stop: () => void calls.push('loop.stop'),
        setTargetFps: () => {},
        setWidth: (w) => void calls.push(`loop.width:${w}`),
      }
    },
    audio,
    wakeLock: {
      request: async () => (calls.push('wakeLock.request'), true),
      release: async () => void calls.push('wakeLock.release'),
      isActive: () => true,
    },
    vibrate: (l) => void calls.push(`vibrate:${l}`),
    watchVisibility: (cb) => ((visibility = cb), () => {}),
    startSpeedMonitor: () => ({ speedKmh: () => (armed ? 50 : 0), armed: () => armed, stop: () => {} }),
    watchdog: {
      kick: (n) => realDog.kick(n),
      check: (n) => realDog.check(n),
      arm: (n) => realDog.arm(n),
      start: (cb) => {
        onStall = cb
        realDog.arm(clock)
      },
      stop: () => {
        onStall = null
        realDog.stop()
      },
    },
    now: () => clock,
    watchBattery: (cb) => ((battery = cb), () => {}),
    startMotionMonitor: () => ({ state: () => ({ turnRate, still: false }), stop: () => void calls.push('motion.stop') }),
    notify: (k) => void calls.push(`notify:${k}`),
  }

  const ctl = createTripController(deps)
  const settle = () => new Promise((r) => setTimeout(r, 0))

  return {
    ctl,
    calls,
    preferArgs,
    get phase() {
      return ctl.getSnapshot().session.phase
    },
    setArmed(v: boolean) {
      armed = v
    },
    setBattery(level: number, charging: boolean) {
      battery?.({ level, charging })
    },
    setTurn(rate: number | null) {
      turnRate = rate
    },
    async start(useLocation = false, notifyWhenPaused = false) {
      ctl.start({} as HTMLVideoElement, { useLocation, notifyWhenPaused })
      await settle()
      await settle()
    },
    /** Feed frames at `fps` for `ms` with the given face spec. */
    async run(ms: number, s: Spec = {}, fps = 15) {
      spec = s
      const end = clock + ms
      while (clock < end) {
        clock += Math.round(1000 / fps)
        if (onFrame) await onFrame({ close() {} } as ImageBitmap, clock)
        if (onStall && realDog.check(clock)) onStall()
      }
      await settle()
    },
    /** Time passes with no frames at all. */
    async silence(ms: number) {
      clock += ms
      if (onStall && realDog.check(clock)) onStall()
      await settle()
      await settle()
    },
    cameraEnded: async () => {
      onCameraEnded?.()
      await settle()
      await settle()
    },
    setHidden: async (h: boolean) => {
      visibility?.(h)
      await settle()
    },
  }
}

/** Setup (GPU benchmark ~2 s + 1.5 s good frames) + calibration with blinks (8 s) → MONITORING. */
async function toMonitoring(h: ReturnType<typeof harness>, extra: Spec = {}) {
  await h.start()
  await h.run(SETUP_MS, extra)
  for (let i = 0; i < 4; i++) {
    await h.run(1800, extra)
    await h.run(200, { ...extra, ear: 0.05, blink: 0.95 })
  }
  await h.run(500, extra)
}

describe('trip controller: happy path', () => {
  it('starts: unlocks audio in the tap, requests wake lock, opens camera, loads model', async () => {
    const h = harness()
    await h.start()
    expect(h.calls.slice(0, 3)).toEqual(['audio.unlock', 'wakeLock.request', 'camera.open'])
    expect(h.calls).toContain('engine.start:gpu')
    expect(h.phase).toBe('SETUP_CHECK')
    expect(h.calls).toContain('chime:test')
  })

  it('setup → calibration → monitoring, using the calibrated face position', async () => {
    const h = harness()
    await toMonitoring(h, { center: { x: 0.62, y: 0.4 } })
    expect(h.phase).toBe('MONITORING')
    expect(h.calls).toContain('speak:calibrate')
    expect(h.ctl.getSnapshot().calibration.approximate).toBe(false)
    await h.run(200)
    expect(h.preferArgs.at(-1)).toEqual({ x: 0.62, y: 0.4 })
  })

  it('microsleep → L1, L2, L3 with vibration; recovery stops it and asks for a break', async () => {
    const h = harness()
    await toMonitoring(h)
    const before = h.calls.length
    await h.run(2300, { ear: 0.05, blink: 0.95 })
    await h.run(3000)
    const after = h.calls.slice(before).filter((c) => /^(alarm|vibrate|speak)/.test(c))
    expect(after).toEqual([
      'alarm:L1', 'vibrate:L1', 'alarm:L2', 'vibrate:L2', 'alarm:L3', 'vibrate:L3',
      'alarmStop', 'vibrate:stop', 'speak:takeBreak',
    ])
  })

  it('end trip stops camera, engine and wake lock and shows the summary', async () => {
    const h = harness()
    await toMonitoring(h)
    h.ctl.endTrip()
    await h.run(100)
    expect(h.phase).toBe('SUMMARY')
    expect(h.calls).toEqual(expect.arrayContaining(['loop.stop', 'engine.dispose', 'camera.stop', 'wakeLock.release']))
  })
})

describe('trip controller: setup and calibration problems', () => {
  it('camera denied → FAULT with a clear message; retry returns to start', async () => {
    const h = harness({ cameraError: new CameraError('denied', 'no') })
    await h.start()
    expect(h.ctl.getSnapshot().session.fault).toBe('CAMERA_DENIED')
    h.ctl.retry()
    expect(h.phase).toBe('IDLE')
  })

  it('model fails to load → FAULT MODEL_FAILED', async () => {
    const h = harness({ engineFails: true })
    await h.start()
    expect(h.ctl.getSnapshot().session.fault).toBe('MODEL_FAILED')
  })

  it('too dark during setup (F2) → FAULT with the "too dark" hint; retry re-runs setup', async () => {
    const h = harness()
    await h.start()
    await h.run(16_000, { faceFound: false, luma: 10 })
    const s = h.ctl.getSnapshot()
    expect(s.session.fault).toBe('SETUP_FAILED')
    expect(s.faultHint).toBe('dark')
    h.ctl.retry()
    expect(h.phase).toBe('SETUP_CHECK')
  })

  it('face too small → "move the phone closer"', async () => {
    const h = harness()
    await h.start()
    await h.run(16_000, { area: 0.01 })
    expect(h.ctl.getSnapshot().faultHint).toBe('small')
  })

  it('no blinks during calibration: 3 attempts, then continues with approximate values', async () => {
    const h = harness()
    await h.start()
    await h.run(SETUP_MS)
    await h.run(3 * 8000 + 500)
    expect(h.phase).toBe('MONITORING')
    expect(h.calls.filter((c) => c === 'speak:calibrate')).toHaveLength(3)
    expect(h.ctl.getSnapshot().calibration.approximate).toBe(true)
    expect(h.ctl.getSnapshot().calibration.retryReason).toBe('no-blinks')
  })
})

describe('trip controller: failures while driving (SPEC §12)', () => {
  it('F20: no frames for 1 s → FAULT, engine restarted, monitoring resumes', async () => {
    const h = harness()
    await toMonitoring(h)
    await h.silence(1500)
    expect(h.calls).toContain('chime:monitoringOff')
    expect(h.calls.filter((c) => c.startsWith('engine.start')).length).toBeGreaterThanOrEqual(2)
    expect(h.phase).toBe('MONITORING')
  })

  it('F19: camera stops → FAULT CAMERA_LOST, camera reopened, monitoring resumes', async () => {
    const h = harness()
    await toMonitoring(h)
    await h.cameraEnded()
    expect(h.calls.filter((c) => c === 'camera.open')).toHaveLength(2)
    expect(h.phase).toBe('MONITORING')
  })

  it('F10: page hidden → paused chime; visible → resumes and re-requests the wake lock (F7)', async () => {
    const h = harness()
    await toMonitoring(h)
    await h.setHidden(true)
    expect(h.phase).toBe('SUSPENDED')
    expect(h.calls).toContain('chime:paused')
    const locks = h.calls.filter((c) => c === 'wakeLock.request').length
    await h.setHidden(false)
    expect(h.phase).toBe('MONITORING')
    expect(h.calls.filter((c) => c === 'wakeLock.request')).toHaveLength(locks + 1)
  })

  it('speed arming: no alarm while stopped, alarm when moving', async () => {
    const h = harness()
    await h.start(true)
    await h.run(SETUP_MS)
    for (let i = 0; i < 4; i++) {
      await h.run(1800)
      await h.run(200, { ear: 0.05, blink: 0.95 })
    }
    await h.run(500)
    h.setArmed(false)
    await h.run(3000, { ear: 0.05, blink: 0.95 })
    expect(h.calls.some((c) => c.startsWith('alarm:'))).toBe(false)
    await h.run(1000)
    h.setArmed(true)
    await h.run(1200, { ear: 0.05, blink: 0.95 })
    expect(h.calls).toContain('alarm:L1')
  })

  it('F16: asks to re-calibrate when the pose stays shifted; recalibrate() learns the new pose', async () => {
    const h = harness()
    await toMonitoring(h)
    await h.run(31_000, { yaw: 20 })
    expect(h.ctl.getSnapshot().needsRecalibration).toBe(true)
    h.ctl.recalibrate()
    for (let i = 0; i < 4; i++) {
      await h.run(1800, { yaw: 20 })
      await h.run(200, { yaw: 20, ear: 0.05, blink: 0.95 })
    }
    await h.run(1000, { yaw: 20 })
    expect(h.ctl.getSnapshot().recalibrating).toBe(false)
    expect(h.ctl.getSnapshot().needsRecalibration).toBe(false)
  })
})

describe('trip controller: performance (SPEC §17.1, F6)', () => {
  it('slow GPU: benchmarks CPU and keeps the faster one before setup passes', async () => {
    const h = harness()
    await h.start()
    await h.run(6000, { inferMs: 120 })
    expect(h.calls).toContain('engine.start:cpu')
    expect(h.ctl.getSnapshot().backend).toBe('worker-cpu')
    expect(h.phase).toBe('CALIBRATING')
  })

  it('clearly slow GPU is decided after ~13 frames, not 30', async () => {
    const h = harness()
    await h.start()
    await h.run(1000, { inferMs: 200 })
    expect(h.calls).toContain('engine.start:cpu')
  })

  it('does not lower the resolution because of the slow GPU benchmark', async () => {
    const h = harness()
    await h.start()
    // Frames at 4 fps while the GPU is measured, then CPU at 15 fps.
    await h.run(4000, { inferMs: 200 }, 4)
    await h.run(8000)
    expect(h.calls).toContain('engine.start:cpu')
    expect(h.calls).not.toContain('loop.width:320')
  })

  it('fast GPU: no benchmark swap', async () => {
    const h = harness()
    await h.start()
    await h.run(SETUP_MS, { inferMs: 15 })
    expect(h.calls).not.toContain('engine.start:cpu')
    expect(h.phase).toBe('CALIBRATING')
  })

  it('slow device: lowers the frame width after 5 s under 10 fps (once the benchmark is done)', async () => {
    const h = harness()
    await h.start()
    // At 6 fps the GPU benchmark (3 warm-up + 30 frames) takes ~5.5 s; then 5 s of low fps.
    await h.run(13_000, {}, 6)
    expect(h.calls).toContain('loop.width:320')
  })
})

describe('trip controller: lifecycle', () => {
  it('dispose() returns to IDLE and the same controller can start again (React StrictMode)', async () => {
    const h = harness()
    await h.start()
    h.ctl.dispose()
    expect(h.phase).toBe('IDLE')
    expect(h.calls).toEqual(expect.arrayContaining(['camera.stop', 'engine.dispose']))
    await h.start()
    expect(h.phase).toBe('SETUP_CHECK')
  })
})

describe('trip controller: GPU warm-up', () => {
  it('a slow first frame (shader compile) is not a stall', async () => {
    const h = harness()
    await h.start()
    await h.silence(3000) // nothing for 3 s after start
    expect(h.phase).toBe('SETUP_CHECK')
    expect(h.calls.filter((c) => c.startsWith('engine.start'))).toHaveLength(1)
  })
})

describe('trip controller: battery and notifications (F18, F10)', () => {
  it('warns once by voice when the battery is low and not charging', async () => {
    const h = harness()
    await toMonitoring(h)
    h.setBattery(0.5, false)
    h.setBattery(0.1, false)
    h.setBattery(0.09, false)
    expect(h.ctl.getSnapshot().batteryLow).toBe(true)
    expect(h.calls.filter((c) => c === 'speak:batteryLow')).toHaveLength(1)
    h.setBattery(0.09, true)
    expect(h.ctl.getSnapshot().batteryLow).toBe(false)
  })

  it('a low battery before monitoring is announced when monitoring starts', async () => {
    const h = harness()
    await h.start()
    h.setBattery(0.1, false)
    expect(h.calls).not.toContain('speak:batteryLow')
    await h.run(SETUP_MS)
    for (let i = 0; i < 4; i++) {
      await h.run(1800)
      await h.run(200, { ear: 0.05, blink: 0.95 })
    }
    await h.run(500)
    expect(h.calls).toContain('speak:batteryLow')
  })

  it('shows a notification when the app is hidden during monitoring, if enabled', async () => {
    const h = harness()
    await h.start(false, true)
    await h.setHidden(true) // not monitoring yet: no notification
    await h.setHidden(false)
    expect(h.calls).not.toContain('notify:paused')
    await h.run(SETUP_MS)
    for (let i = 0; i < 4; i++) {
      await h.run(1800)
      await h.run(200, { ear: 0.05, blink: 0.95 })
    }
    await h.run(500)
    await h.setHidden(true)
    expect(h.calls).toContain('notify:paused')
  })

  it('passes the voice language to the audio engine', () => {
    const h = harness()
    h.ctl.setLanguage('vi')
    expect(h.calls).toContain('lang:vi')
  })
})

describe('trip controller: P2 context (speed, motion, mount)', () => {
  it('warns when calibration shows the phone is mounted far to the side (A23)', async () => {
    const h = harness()
    await toMonitoring(h, { yaw: 38 })
    expect(h.ctl.getSnapshot().mountWarning).toBe(true)
  })

  it('no mount warning for a centered phone', async () => {
    const h = harness()
    await toMonitoring(h)
    expect(h.ctl.getSnapshot().mountWarning).toBe(false)
  })

  it('looking right into a right turn is driving; the same look without a turn alarms (T2)', async () => {
    const h = harness()
    await toMonitoring(h)
    h.setTurn(25)
    await h.run(2500, { yaw: 45 })
    expect(h.calls.some((c) => c.startsWith('alarm:D'))).toBe(false)
    await h.run(2000)
    h.setTurn(0)
    await h.run(2500, { yaw: 45 })
    expect(h.calls.some((c) => c.startsWith('alarm:D'))).toBe(true)
  })

  it('stops the motion monitor at the end of the trip', async () => {
    const h = harness()
    await toMonitoring(h)
    h.ctl.endTrip()
    expect(h.calls).toContain('motion.stop')
  })

  it('with location on and the car stopped: closed eyes give an advisory, not an alarm (C08)', async () => {
    const h = harness()
    await h.start(true)
    await h.run(SETUP_MS)
    for (let i = 0; i < 4; i++) {
      await h.run(1800)
      await h.run(200, { ear: 0.05, blink: 0.95 })
    }
    await h.run(500)
    h.setArmed(false) // speed 0
    await h.run(3000, { ear: 0.05, blink: 0.95 })
    expect(h.calls.some((c) => c.startsWith('alarm:'))).toBe(false)
    expect(h.calls).toContain('speak:fatigueAdvisory')
  })
})

