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
import { createTripController, type TripController, type TripDeps, type TripSnapshot } from './controller.ts'

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

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { controller, snapshot }
}
