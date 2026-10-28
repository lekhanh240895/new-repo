import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import type { AlarmLevel, Phase } from '../../core/fsm/types.ts'
import { atLimit, markFalseAlarm, personalize, scaleFor, type Personal } from '../../core/personal.ts'
import { requestMotionPermission } from '../../platform/motion.ts'
import { loadPersonal, resetPersonal, savePersonal } from '../../platform/personalStore.ts'
import { requestNotificationPermission } from '../../platform/notify.ts'
import { devToolsEnabled } from '../devTools.ts'
import { AlertIcon, CameraIcon, CheckIcon, EyeIcon, EyeOffIcon, LogoIcon, MoonIcon } from '../Icons.tsx'
import { useLang, type TextKey } from '../i18n.ts'
import { installUpdate, usePwaState } from '../pwa.ts'
import type { AlertRecord, TripSnapshot } from './controller.ts'
import { TestPanel } from './TestPanel.tsx'
import { useTrip } from './useTrip.ts'

const ACCEPT_KEY = 'biomonitor.accepted.v1'

function readAccepted(): boolean {
  try {
    return localStorage.getItem(ACCEPT_KEY) === 'yes'
  } catch {
    return false
  }
}

function saveAccepted(): void {
  try {
    localStorage.setItem(ACCEPT_KEY, 'yes')
  } catch {
    // Not saved: the driver is asked again next time.
  }
}

/** Phases where the app header and tabs are hidden (Dark Cockpit, SPEC §12 F14). */
const IMMERSIVE: ReadonlySet<Phase> = new Set<Phase>(['CALIBRATING', 'MONITORING', 'SUSPENDED', 'FAULT'])

const ALARM_CLASS: Record<AlarmLevel, string> = {
  D1: 'alarm-soft',
  L1: 'alarm-soft',
  D2: 'alarm-medium',
  L2: 'alarm-medium',
  L3: 'alarm-strong',
}

function isAlarm(level: string): level is AlarmLevel {
  return level in ALARM_CLASS
}

function SetupChecklist({ snap, t }: { snap: TripSnapshot; t: (k: TextKey) => string }) {
  const { setup } = snap
  const item = (ok: boolean, key: TextKey) => (
    <li className={ok ? 'ok' : 'pending'}>
      <span className="tick">{ok ? <CheckIcon size={16} /> : null}</span>
      {t(key)}
    </li>
  )
  return (
    <>
      <ul className="checklist">
        {item(setup.faceSeen, 'setup.face')}
        {item(setup.faceSeen && setup.lightOk, 'setup.light')}
        {item(setup.faceSeen && setup.sizeOk, 'setup.size')}
        {item(snap.wakeLockActive, 'setup.screen')}
        {item(snap.audioReady, 'setup.sound')}
      </ul>
      <p className="muted">{t('setup.beep')}</p>
      {setup.hint !== null && <p className="hint" role="status">{t(`hint.${setup.hint}`)}</p>}
    </>
  )
}

function Summary({ snap, t }: { snap: TripSnapshot; t: (k: TextKey) => string }) {
  const { session } = snap
  const stats = session.monitoring.stats
  const ms = Math.max(0, (session.tripEndedAt ?? 0) - (session.tripStartedAt ?? 0))
  // Episodes, not levels: one alarm that escalates L1 → L2 → L3 counts once.
  const microsleeps = snap.alerts.filter((a) => a.family === 'L').length
  const distractions = snap.alerts.filter((a) => a.family === 'D').length
  const duration = `${Math.floor(ms / 60_000)} ${t('unit.min')} ${Math.floor((ms % 60_000) / 1000)} ${t('unit.sec')}`
  return (
    <>
      <dl className="summary">
        <div><dt>{t('summary.time')}</dt><dd>{duration}</dd></div>
        <div><dt>{t('summary.microsleep')}</dt><dd>{microsleeps}</dd></div>
        <div><dt>{t('summary.distraction')}</dt><dd>{distractions}</dd></div>
        <div><dt>{t('summary.longest')}</dt><dd>{(stats.longestClosureMs / 1000).toFixed(1)} {t('unit.sec')}</dd></div>
      </dl>
      <p className={microsleeps > 0 ? 'hint' : 'muted'}>
        {microsleeps > 0 ? t('summary.rest') : microsleeps + distractions === 0 ? t('summary.noAlerts') : ''}
      </p>
    </>
  )
}

/**
 * After the trip (parked): mark alerts that were wrong (T12). Each mark loosens
 * that alert type a little for the next trips, within the safety limit.
 */
function AlertReview({ alerts, t }: { alerts: readonly AlertRecord[]; t: (k: TextKey) => string }) {
  const [personal, setPersonal] = useState<Personal>(loadPersonal)
  const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set())
  const [saveFailed, setSaveFailed] = useState(false)
  const percent = (f: 'D' | 'L') => String(Math.round((scaleFor(personal, f) - 1) * 100))

  function mark(a: AlertRecord) {
    const next = markFalseAlarm(personal, a.family)
    setSaveFailed(!savePersonal(next))
    setPersonal(next)
    setMarked(new Set(marked).add(a.id))
  }
  function reset() {
    setSaveFailed(!resetPersonal())
    setPersonal(loadPersonal())
  }

  // L2/L3 (eyes closed 1.5 s or more) never change, so marking them would do nothing —
  // and a driver who really dozed off often does not notice it.
  const canMark = (a: AlertRecord) => a.family === 'D' || a.level === 'L1'
  const changed = personal.marksD > 0 || personal.marksL > 0
  return (
    <div className="alert-review">
      {alerts.length > 0 && (
        <>
          <h3>{t('summary.alertsTitle')}</h3>
          <p className="muted small">{t('summary.alertsHelp')}</p>
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id}>
                <span>
                  {Math.floor(a.atSec / 60)}:{String(a.atSec % 60).padStart(2, '0')} · {t(a.family === 'D' ? 'summary.alertD' : 'summary.alertL')} ({a.level})
                </span>
                {marked.has(a.id) ? (
                  <span className="muted small">{t('summary.marked')}</span>
                ) : !canMark(a) ? (
                  <span className="muted small">{t('summary.alwaysCounted')}</span>
                ) : atLimit(personal, a.family) ? (
                  <span className="muted small">{t('summary.atLimit')}</span>
                ) : (
                  <button type="button" onClick={() => mark(a)}>{t('summary.markFalse')}</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {changed && (
        <p className="muted small">
          {t('summary.personal').replace('{d}', percent('D')).replace('{l}', percent('L'))}{' '}
          <button type="button" className="link" onClick={reset}>{t('summary.personalReset')}</button>
        </p>
      )}
      {saveFailed && <p className="hint small">{t('summary.saveFailed')}</p>}
    </div>
  )
}

function exitFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}

/** The trip screen: start, setup, calibration, Dark Cockpit monitoring, faults, summary. */
export function TripView() {
  const { controller, snapshot: snap } = useTrip()
  const { lang, t } = useLang()
  const pwa = usePwaState()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [accepted, setAccepted] = useState(readAccepted)
  // Decisions 2 and 3: location and motion sensors are on by default (both stay on the phone).
  const [useLocation, setUseLocation] = useState(true)
  const [useMotion, setUseMotion] = useState(true)
  const [notify, setNotify] = useState(false)
  // Developer behavior check (?test): live detector readouts and a pass/fail test for desk use.
  const devTools = devToolsEnabled()
  const [testMode, setTestMode] = useState(() => devTools && new URLSearchParams(window.location.search).has('test'))
  const { phase } = snap.session
  const alert = snap.session.monitoring.alert
  const immersive = IMMERSIVE.has(phase)
  const alarmClass = phase === 'MONITORING' && isAlarm(alert) ? ALARM_CLASS[alert] : ''

  useEffect(() => controller.setLanguage(lang), [controller, lang])

  // Dark Cockpit: hide the app chrome; leave full screen when the trip ends.
  useEffect(() => {
    document.body.classList.toggle('immersive', immersive)
    if (phase === 'SUMMARY' || phase === 'IDLE') exitFullscreen()
    return () => document.body.classList.remove('immersive')
  }, [immersive, phase])

  const start = () => {
    const video = videoRef.current
    if (video === null || !accepted) return
    const params = new URLSearchParams(window.location.search)
    // All of this must happen inside the tap: full screen, audio, camera, notifications.
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {})
    if (notify) void requestNotificationPermission()
    if (useMotion) void requestMotionPermission()
    controller.start(video, {
      // Indoors there is no speed, and a still phone then reads as a parked car: test mode skips it.
      useLocation: useLocation && !testMode,
      useMotion,
      notifyWhenPaused: notify,
      preferGpu: params.get('delegate') !== 'cpu',
      preferWorker: params.get('worker') !== '0',
      // The driver's "false alarm" marks from earlier trips (T12), within the safety limit.
      config: personalize(DEFAULT_CONFIG, loadPersonal()),
    })
  }

  return (
    <section className={`trip phase-${phase.toLowerCase()} ${immersive ? 'cockpit-screen' : ''} ${alarmClass}`}>
      {/* Kept mounted so frames keep flowing; only visible during the setup check. */}
      <video ref={videoRef} className={phase === 'SETUP_CHECK' ? 'setup-preview' : 'hidden-video'} muted playsInline />

      {phase === 'IDLE' && (
        <>
          {pwa.updateReady && (
            <div className="update" role="status">
              <span>{t('idle.update')}</span>
              <button type="button" onClick={installUpdate}>{t('idle.updateNow')}</button>
            </div>
          )}
          <div className="hero">
            <span className="hero-icon"><LogoIcon size={40} /></span>
            <h2>{t('idle.heroTitle')}</h2>
            <p>{t('idle.tagline')}</p>
          </div>
          <article className="card disclaimer">
            <p><strong>{t('idle.disclaimerTitle')}</strong> {t('idle.disclaimerBody')}</p>
            <p>{t('idle.limits')}</p>
            <p className="muted small">{t('idle.privacy')}</p>
            <label className="accept">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  setAccepted(e.target.checked)
                  if (e.target.checked) saveAccepted()
                }}
              />
              {t('idle.accept')}
            </label>
          </article>
          <details className="mount card">
            <summary>{t('idle.mountTitle')}</summary>
            <ol>
              <li>{t('idle.mount1')}</li>
              <li>{t('idle.mount2')}</li>
              <li>{t('idle.mount3')}</li>
              <li>{t('idle.mount4')}</li>
            </ol>
          </details>
          <article className="card options">
            <label className="toggle">
              <input type="checkbox" role="switch" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
              {t('idle.location')}
            </label>
            <label className="toggle">
              <input type="checkbox" role="switch" checked={useMotion} onChange={(e) => setUseMotion(e.target.checked)} />
              {t('idle.motion')}
            </label>
            <label className="toggle">
              <input type="checkbox" role="switch" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {t('idle.notify')}
            </label>
            {devTools && (
              <label className="toggle">
                <input type="checkbox" role="switch" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
                {lang === 'vi' ? 'Bảng kiểm tra hành vi (khi test tại bàn, tự tắt vị trí)' : 'Behavior check panel (desk testing, location off)'}
              </label>
            )}
          </article>
          <button type="button" className="primary" onClick={start} disabled={!accepted}>
            {t('idle.start')}
          </button>
          {pwa.offlineReady && <p className="muted small">{t('idle.offline')}</p>}
        </>
      )}

      {phase === 'PERMISSIONS' && <p className="status">{t('status.permissions')}</p>}
      {phase === 'LOADING' && <p className="status">{t('status.loading')}</p>}

      {phase === 'SETUP_CHECK' && <SetupChecklist snap={snap} t={t} />}

      {phase === 'CALIBRATING' && (
        <div className="calibrating">
          <span className="calib-icon"><CameraIcon size={36} /></span>
          <p className="big">{t('calib.prompt')}</p>
          {snap.calibration.attempt > 1 && snap.calibration.retryReason !== null && (
            <p className="hint">{t(`calib.retry.${snap.calibration.retryReason}`)}</p>
          )}
          <progress max={1} value={snap.calibration.progress} />
        </div>
      )}

      {phase === 'MONITORING' && (
        <div className="cockpit">
          <div className="cockpit-center">
            {isAlarm(alert) ? (
              <div className={`alarm-panel alarm-${alert.startsWith('D') ? 'look' : 'sleep'}`} role="alert">
                <span className="alarm-icon">{alert.startsWith('D') ? <AlertIcon size={44} /> : <MoonIcon size={44} />}</span>
                <p className="alarm-text">{t(`alarm.${alert}`)}</p>
                <button type="button" className="primary" onClick={() => controller.ackAwake()}>
                  {t('alarm.ack')}
                </button>
              </div>
            ) : (
              <div className={`orb orb-${snap.hud}`} role="status">
                <span className="orb-core">{snap.hud === 'off' ? <EyeOffIcon size={34} /> : <EyeIcon size={34} />}</span>
                <p className="orb-label">{t(`hud.${snap.hud}`)}</p>
              </div>
            )}
            {!isAlarm(alert) && snap.hud === 'off' && <p className="cockpit-note" role="status">{t('cockpit.notMonitoring')}</p>}
            {(alert === 'ADVISORY' || alert === 'STRONG_ADVISORY') && (
              <p className="advisory" role="status">
                {t(alert === 'STRONG_ADVISORY' ? 'advisory.strong' : 'advisory.normal')}
              </p>
            )}
            {(snap.debug?.speedClass === 'maneuver' || snap.debug?.speedClass === 'stopped') && <p className="hint">{t('cockpit.parked')}</p>}
            {!snap.audioReady && <p className="hint">{t('cockpit.noSound')}</p>}
            {snap.batteryLow && <p className="hint">{t('cockpit.battery')}</p>}
            {snap.needsRecalibration && !snap.recalibrating && (
              <button type="button" onClick={() => controller.recalibrate()}>{t('cockpit.recalibrate')}</button>
            )}
            {snap.recalibrating && <p className="cockpit-note">{t('cockpit.recalibrating')}</p>}
          </div>
          {devTools && testMode && <TestPanel snap={snap} lang={lang} />}
          <div className="cockpit-footer">
            {snap.calibration.approximate && <p className="cockpit-note small">{t('cockpit.approx')}</p>}
            {snap.mountWarning && <p className="cockpit-note small">{t('cockpit.mountSide')}</p>}
            <button type="button" className="secondary outline end-trip" onClick={() => controller.endTrip()}>{t('cockpit.end')}</button>
          </div>
        </div>
      )}

      {phase === 'SUSPENDED' && <p className="status">{t('suspended')}</p>}

      {phase === 'FAULT' && (
        <div className="fault" role="alert">
          <p className="big">{t('fault.title')}</p>
          <p>{snap.faultHint !== null ? t(`hint.${snap.faultHint}`) : t(`fault.${snap.session.fault ?? 'SETUP_FAILED'}`)}</p>
          {snap.faultGaveUp && <p className="hint">{t('fault.gaveUp')}</p>}
          {devTools && snap.faultDetail !== null && <p className="muted small">{snap.faultDetail}</p>}
          <div className="row">
            {!snap.faultGaveUp && (
              <button type="button" className="primary" onClick={() => controller.retry()}>{t('fault.retry')}</button>
            )}
            <button type="button" className="secondary outline" onClick={() => controller.endTrip()}>{t('fault.end')}</button>
          </div>
        </div>
      )}

      {phase === 'SUMMARY' && (
        <>
          <h2>{t('summary.title')}</h2>
          <Summary snap={snap} t={t} />
          <AlertReview alerts={snap.alerts} t={t} />
          <button type="button" className="primary" onClick={() => controller.reset()}>{t('summary.new')}</button>
        </>
      )}

      {devTools && snap.backend !== null && !immersive && phase !== 'IDLE' && (
        <p className="muted small">
          {snap.backend}
          {snap.frameWidth !== 480 ? ` · ${snap.frameWidth}px` : ''}
        </p>
      )}
    </section>
  )
}
