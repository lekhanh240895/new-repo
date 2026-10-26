import { useRef, useState, type ReactNode } from 'react'
import type { AlertLevel } from '../../core/fsm/types.ts'
import { calibrationRetryText, type TripSnapshot } from './controller.ts'
import { useTrip } from './useTrip.ts'

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

const ALARM_CLASS: Partial<Record<AlertLevel, string>> = {
  D1: 'alarm-soft',
  L1: 'alarm-soft',
  D2: 'alarm-medium',
  L2: 'alarm-medium',
  L3: 'alarm-strong',
}

const ALARM_TEXT: Partial<Record<AlertLevel, string>> = {
  D1: 'Eyes on the road',
  D2: 'Eyes on the road!',
  L1: 'Stay awake',
  L2: 'Wake up!',
  L3: 'WAKE UP!',
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min} min ${sec} s`
}

function SetupChecklist({ snap }: { snap: TripSnapshot }) {
  const { setup } = snap
  const item = (ok: boolean, label: string) => (
    <li className={ok ? 'ok' : 'pending'}>
      {ok ? '✓' : '…'} {label}
    </li>
  )
  return (
    <>
      <ul className="checklist">
        {item(setup.faceSeen, 'Face found')}
        {item(setup.faceSeen && setup.lightOk, 'Light OK')}
        {item(setup.faceSeen && setup.sizeOk, 'Phone close enough')}
        {item(snap.wakeLockActive, 'Screen stays on')}
        {item(snap.audioReady, 'Sound ready')}
      </ul>
      <p className="muted">You should have heard a beep. If not, turn the media volume up.</p>
      {setup.hint !== null && <p className="hint" role="status">{setup.hint}</p>}
    </>
  )
}

function Summary({ snap }: { snap: TripSnapshot }) {
  const { session } = snap
  const stats = session.monitoring.stats
  const duration = (session.tripEndedAt ?? 0) - (session.tripStartedAt ?? 0)
  const microsleeps = stats.alarms.L1 + stats.alarms.L2 + stats.alarms.L3
  const distractions = stats.alarms.D1 + stats.alarms.D2
  return (
    <dl className="summary">
      <div><dt>Trip time</dt><dd>{formatDuration(duration)}</dd></div>
      <div><dt>Microsleep alerts</dt><dd>{microsleeps}</dd></div>
      <div><dt>Eyes-off-road alerts</dt><dd>{distractions}</dd></div>
      <div><dt>Longest eye closure</dt><dd>{(stats.longestClosureMs / 1000).toFixed(1)} s</dd></div>
    </dl>
  )
}

/**
 * Trip screen (M2: functional). The polished Dark Cockpit design comes in M3.
 */
export function TripView() {
  const { controller, snapshot: snap } = useTrip()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [useLocation, setUseLocation] = useState(false)
  const { phase } = snap.session
  const alert = snap.session.monitoring.alert
  const alarmClass = phase === 'MONITORING' ? (ALARM_CLASS[alert] ?? '') : ''

  const start = () => {
    const video = videoRef.current
    if (video === null) return
    const params = new URLSearchParams(window.location.search)
    controller.start(video, {
      useLocation,
      preferGpu: params.get('delegate') !== 'cpu',
      preferWorker: params.get('worker') !== '0',
    })
  }

  return (
    <section className={`trip phase-${phase.toLowerCase()} ${alarmClass}`}>
      {/* Kept mounted so frames keep flowing; only visible during the setup check. */}
      <video ref={videoRef} className={phase === 'SETUP_CHECK' ? 'setup-preview' : 'hidden-video'} muted playsInline />

      {phase === 'IDLE' && (
        <>
          <div className="disclaimer">
            <p><strong>Not a certified safety device.</strong> It does not replace rest. You stay fully responsible for driving safely.</p>
            <p>Daytime only: the phone camera cannot see your face in the dark. Keep this app open in front.</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
            Use location to stay quiet when the car is stopped
          </label>
          <button type="button" className="primary" onClick={start}>Start trip</button>
        </>
      )}

      {phase === 'PERMISSIONS' && <p className="status">Starting the camera…</p>}
      {phase === 'LOADING' && <p className="status">Loading face tracking…</p>}

      {phase === 'SETUP_CHECK' && <SetupChecklist snap={snap} />}

      {phase === 'CALIBRATING' && (
        <div className="calibrating">
          <p className="big">Look at the road and blink normally.</p>
          {snap.calibration.attempt > 1 && snap.calibration.retryReason !== null && (
            <p className="hint">{calibrationRetryText(snap.calibration.retryReason)}</p>
          )}
          <progress max={1} value={snap.calibration.progress} />
        </div>
      )}

      {phase === 'MONITORING' && (
        <div className="cockpit">
          <span className={`dot dot-${snap.hud}`} aria-label={`Status: ${snap.hud}`} />
          {alarmClass !== '' && (
            <div className="alarm-panel" role="alert">
              <p className="alarm-text">{ALARM_TEXT[alert]}</p>
              <button type="button" className="primary" onClick={() => controller.ackAwake()}>I'm awake</button>
            </div>
          )}
          {(alert === 'ADVISORY' || alert === 'STRONG_ADVISORY') && (
            <p className="advisory" role="status">
              {alert === 'STRONG_ADVISORY' ? 'You are tired. Please stop at a safe place.' : 'Signs of fatigue. Plan a break soon.'}
            </p>
          )}
          {!snap.audioReady && <p className="hint">Sound is blocked: visual alerts only.</p>}
          {snap.calibration.approximate && <p className="muted small">Calibration is approximate.</p>}
          {snap.needsRecalibration && !snap.recalibrating && (
            <button type="button" onClick={() => controller.recalibrate()}>Phone moved? Re-calibrate</button>
          )}
          {snap.recalibrating && <p className="muted small">Re-calibrating… look at the road.</p>}
          <HoldButton onHold={() => controller.endTrip()}>Hold to end trip</HoldButton>
        </div>
      )}

      {phase === 'SUSPENDED' && <p className="status">Monitoring paused. Come back to this app to continue.</p>}

      {phase === 'FAULT' && (
        <div className="fault" role="alert">
          <p className="big">Monitoring is off</p>
          <p>{snap.faultMessage ?? 'Something went wrong.'}</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => controller.retry()}>Try again</button>
            <button type="button" onClick={() => controller.endTrip()}>End trip</button>
          </div>
        </div>
      )}

      {phase === 'SUMMARY' && (
        <>
          <h2>Trip summary</h2>
          <Summary snap={snap} />
          <button type="button" className="primary" onClick={() => controller.reset()}>New trip</button>
        </>
      )}

      {snap.backend !== null && phase !== 'MONITORING' && (
        <p className="muted small">Face tracking: {snap.backend}{snap.frameWidth !== 480 ? ` · ${snap.frameWidth}px` : ''}</p>
      )}
    </section>
  )
}
