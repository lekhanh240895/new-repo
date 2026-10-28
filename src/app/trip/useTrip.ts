import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import { createAudioEngine } from '../../platform/audio.ts'
import { openCamera } from '../../platform/camera.ts'
import { watchBattery } from '../../platform/battery.ts'
import { createScreenWakeLock, vibrateFor, watchVisibility } from '../../platform/device.ts'
import { startFrameLoop } from '../../platform/frameLoop.ts'
import { startMotionMonitor } from '../../platform/motion.ts'
import { startSpeedMonitor } from '../../platform/speed.ts'
import { createWatchdog } from '../../platform/watchdog.ts'
import { showNotification } from '../../platform/notify.ts'
import { startVisionEngine } from '../../vision/engine.ts'
import { currentLang, translate } from '../i18n.ts'
import { createSession, hudStatus, type AlertLevel, type Phase } from '../../core/fsm/index.ts'
import { devToolsEnabled } from '../devTools.ts'
import { createTripController, initialTripSnapshot, type TripController, type TripDeps, type TripSnapshot } from './controller.ts'

declare global {
  interface Window {
    /** Set with ?replay — the trip replay harness reads it. */
    __biomonitorTrip?: { snapshot: () => TripSnapshot };
  }
}

function realDeps(): TripDeps {
  return {
    openCamera,
    startEngine: startVisionEngine,
    startFrameLoop,
    audio: createAudioEngine(),
    wakeLock: createScreenWakeLock(),
    vibrate: vibrateFor,
    watchVisibility,
    startSpeedMonitor: (armAboveKmh) => startSpeedMonitor(armAboveKmh),
    watchdog: createWatchdog(DEFAULT_CONFIG.watchdog.stallMs, DEFAULT_CONFIG.watchdog.startupMs),
    now: () => performance.now(),
    watchBattery,
    startMotionMonitor: () => startMotionMonitor(),
    notify: () => {
      const lang = currentLang()
      showNotification(translate(lang, 'notify.title'), translate(lang, 'notify.body'))
    },
  }
}

/** Dev only: ?ui=MONITORING,L2 shows a screen without a camera, to work on the design. */
function designSnapshot(): TripSnapshot | null {
  if (!devToolsEnabled()) return null
  const ui = new URLSearchParams(window.location.search).get('ui')
  if (ui === null) return null
  const [phase = 'IDLE', alert = 'NONE'] = ui.split(',')
  const base = createSession()
  const session = {
    ...base,
    phase: phase as Phase,
    tripStartedAt: 0,
    tripEndedAt: 95_000,
    monitoring: { ...base.monitoring, alert: alert as AlertLevel, latched: /^(D|L)\d$/.test(alert) ? (alert as 'D1') : null },
  }
  const snap = initialTripSnapshot(DEFAULT_CONFIG, session)
  return {
    ...snap,
    hud: hudStatus(session),
    audioReady: true,
    setup: { faceSeen: true, lightOk: true, sizeOk: false, hint: 'small' },
    calibration: { attempt: 1, progress: 0.6, retryReason: null, approximate: false },
    alerts: [
      { id: 1, atSec: 42, family: 'D', level: 'D1' },
      { id: 2, atSec: 71, family: 'L', level: 'L1' },
    ],
    faultHint: phase === 'FAULT' ? 'noFace' : null,
  }
}

export function useTrip(): { controller: TripController; snapshot: TripSnapshot } {
  const [controller] = useState(() => createTripController(realDeps()))

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('replay')) {
      window.__biomonitorTrip = { snapshot: () => controller.getSnapshot() }
    }
    // dispose() releases devices but keeps the controller usable, so React
    // StrictMode's mount → cleanup → mount cycle is safe.
    return () => controller.dispose()
  }, [controller])

  const live = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [design] = useState(designSnapshot)
  return { controller, snapshot: design ?? live }
}
