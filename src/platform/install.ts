/**
 * "Install the app" (PWA). Android/desktop Chromium fire `beforeinstallprompt`:
 * keep it and show our own button, which opens the system install dialog.
 * iPhone/iPad have no such event: the user adds the app with Share → Add to
 * Home Screen, so the card shows those steps instead.
 */
import { useSyncExternalStore } from 'react'

export type InstallPlatform = 'ios' | 'other'

/** Chromium's install event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Running from the home screen (standalone window). */
  installed: boolean;
  /** The browser offered installation: one tap opens its dialog. */
  canPrompt: boolean;
  platform: InstallPlatform;
  /** The driver closed the card ("Not now"). */
  dismissed: boolean;
}

/** iPhone, iPod, iPad — including iPadOS, which reports itself as a Mac with touch. */
export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios'
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios'
  return 'other'
}

/** What the install card offers: one-tap install, the iPhone steps, or nothing. */
export function installOffer(s: InstallState): 'prompt' | 'iosSteps' | null {
  if (s.installed || s.dismissed) return null
  if (s.canPrompt) return 'prompt'
  return s.platform === 'ios' ? 'iosSteps' : null
}

const DISMISS_KEY = 'biomonitor.installDismissed.v1'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'yes'
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

let state: InstallState = { installed: false, canPrompt: false, platform: 'other', dismissed: false }
let deferred: BeforeInstallPromptEvent | null = null
let started = false
const listeners = new Set<() => void>()

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/** Call once at start-up, before the first render: the browser may fire the event early. */
export function initInstall(): void {
  if (started || typeof window === 'undefined') return
  started = true
  state = {
    installed: isStandalone(),
    canPrompt: false,
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    dismissed: readDismissed(),
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the event: our card opens the dialog when the driver asks, not the browser's mini-bar.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    set({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ installed: true, canPrompt: false })
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => set({ installed: e.matches }))
}

/** Opens the system install dialog. Returns true when the driver accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (e === null) return false
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    // The event can be used only once; the browser fires a new one if installing is still possible.
    deferred = null
    set({ canPrompt: false })
    return outcome === 'accepted'
  } catch (err) {
    console.warn('BioMonitor: install dialog failed', err)
    deferred = null
    set({ canPrompt: false })
    return false
  }
}

/** "Not now": hide the card on this device. */
export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'yes')
  } catch {
    // Not saved: the card comes back next time, which is harmless.
  }
  set({ dismissed: true })
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
