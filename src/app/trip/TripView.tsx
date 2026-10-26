import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AlarmLevel, Phase } from '../../core/fsm/types.ts'
import { requestNotificationPermission } from '../../platform/notify.ts'
import { useLang, type TextKey } from '../i18n.ts'
import { installUpdate, usePwaState } from '../pwa.ts'
import type { TripSnapshot } from './controller.ts'
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

/** Press and hold to act: avoids ending a trip by accident while driving (SPEC §16). */
function HoldButton({ onHold, children, ms = 800 }: { onHold: () => void; children: ReactNode; ms?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  return (
    <button
      type="button"
      className={`hold ${holding ? 'holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${ms}ms` }}
      onPointerDown={() => {
        setHolding(true)
        timer.current = setTimeout(() => {
          cancel()
          onHold()
        }, ms)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onHold()
      }}
    >
      {children}
    </button>
  )
}

function SetupChecklist({ snap, t }: { snap: TripSnapshot; t: (k: TextKey) => string }) {
  const { setup } = snap
  const item = (ok: boolean, key: TextKey) => (
    <li className={ok ? 'ok' : 'pending'}>
      {ok ? '✓' : '…'} {t(key)}
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
  const microsleeps = stats.alarms.L1 + stats.alarms.L2 + stats.alarms.L3
  const distractions = stats.alarms.D1 + stats.alarms.D2
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
  const [useLocation, setUseLocation] = useState(false)
  const [notify, setNotify] = useState(false)
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
    controller.start(video, {
      useLocation,
      notifyWhenPaused: notify,
      preferGpu: params.get('delegate') !== 'cpu',
      preferWorker: params.get('worker') !== '0',
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
          <div className="disclaimer">
            <p><strong>{t('idle.disclaimerTitle')}</strong> {t('idle.disclaimerBody')}</p>
            <p>{t('idle.limits')}</p>
            <p className="muted">{t('idle.privacy')}</p>
            <label className="toggle">
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
          </div>
          <details className="mount">
            <summary>{t('idle.mountTitle')}</summary>
            <ol>
              <li>{t('idle.mount1')}</li>
              <li>{t('idle.mount2')}</li>
              <li>{t('idle.mount3')}</li>
              <li>{t('idle.mount4')}</li>
            </ol>
          </details>
          <label className="toggle">
            <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
            {t('idle.location')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {t('idle.notify')}
          </label>
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
          <p className="big">{t('calib.prompt')}</p>
          {snap.calibration.attempt > 1 && snap.calibration.retryReason !== null && (
            <p className="hint">{t(`calib.retry.${snap.calibration.retryReason}`)}</p>
          )}
          <progress max={1} value={snap.calibration.progress} />
        </div>
      )}

      {phase === 'MONITORING' && (
        <div className="cockpit">
          <span className={`dot dot-${snap.hud}`} role="img" aria-label={t(`hud.${snap.hud}`)} />
          <div className="cockpit-center">
            {isAlarm(alert) && (
              <div className="alarm-panel" role="alert">
                <p className="alarm-text">{t(`alarm.${alert}`)}</p>
                <button type="button" className="primary" onClick={() => controller.ackAwake()}>
                  {t('alarm.ack')}
                </button>
              </div>
            )}
            {!isAlarm(alert) && snap.hud === 'off' && <p className="cockpit-note" role="status">{t('cockpit.notMonitoring')}</p>}
            {(alert === 'ADVISORY' || alert === 'STRONG_ADVISORY') && (
              <p className="advisory" role="status">
                {t(alert === 'STRONG_ADVISORY' ? 'advisory.strong' : 'advisory.normal')}
              </p>
            )}
            {!snap.audioReady && <p className="hint">{t('cockpit.noSound')}</p>}
            {snap.batteryLow && <p className="hint">{t('cockpit.battery')}</p>}
            {snap.needsRecalibration && !snap.recalibrating && (
              <button type="button" onClick={() => controller.recalibrate()}>{t('cockpit.recalibrate')}</button>
            )}
            {snap.recalibrating && <p className="cockpit-note">{t('cockpit.recalibrating')}</p>}
          </div>
          <div className="cockpit-footer">
            {snap.calibration.approximate && <p className="cockpit-note small">{t('cockpit.approx')}</p>}
            <HoldButton onHold={() => controller.endTrip()}>{t('cockpit.end')}</HoldButton>
          </div>
        </div>
      )}

      {phase === 'SUSPENDED' && <p className="status">{t('suspended')}</p>}

      {phase === 'FAULT' && (
        <div className="fault" role="alert">
          <p className="big">{t('fault.title')}</p>
          <p>{snap.faultHint !== null ? t(`hint.${snap.faultHint}`) : t(`fault.${snap.session.fault ?? 'SETUP_FAILED'}`)}</p>
          {snap.faultGaveUp && <p className="hint">{t('fault.gaveUp')}</p>}
          {snap.faultDetail !== null && <p className="muted small">{snap.faultDetail}</p>}
          <div className="row">
            {!snap.faultGaveUp && (
              <button type="button" className="primary" onClick={() => controller.retry()}>{t('fault.retry')}</button>
            )}
            <button type="button" onClick={() => controller.endTrip()}>{t('fault.end')}</button>
          </div>
        </div>
      )}

      {phase === 'SUMMARY' && (
        <>
          <h2>{t('summary.title')}</h2>
          <Summary snap={snap} t={t} />
          <button type="button" className="primary" onClick={() => controller.reset()}>{t('summary.new')}</button>
        </>
      )}

      {snap.backend !== null && !immersive && phase !== 'IDLE' && (
        <p className="muted small">
          {snap.backend}
          {snap.frameWidth !== 480 ? ` · ${snap.frameWidth}px` : ''}
        </p>
      )}
    </section>
  )
}
