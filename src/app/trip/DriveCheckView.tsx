import { useMemo, useState } from 'react'
import { checkDrive } from '../../core/drive/check.ts'
import type { DriveLogFile } from '../../core/drive/log.ts'
import type { TextKey } from '../i18n.ts'

/** Below this the result means little: too few turns and stops to judge. */
const MIN_DRIVE_SEC = 5 * 60

function fill(text: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text)
}

/** Saves the log as a JSON file. Returns false when the browser refuses. */
function saveLog(log: DriveLogFile): boolean {
  try {
    const blob = new Blob([JSON.stringify(log)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `biomonitor-drive-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/**
 * After the trip (parked): does the GPS speed work, and is the turn sensor the right way
 * round (plan P8)? Results come from the drive log; the log can be saved to send it.
 */
export function DriveCheckView({ log, t }: { log: DriveLogFile | null; t: (k: TextKey) => string }) {
  const [saveFailed, setSaveFailed] = useState(false)
  const report = useMemo(() => (log === null || log.rows.length === 0 ? null : checkDrive(log)), [log])
  if (log === null || report === null) return null

  const { gps, gyro } = report
  const all = gyro.agree + gyro.disagree
  const gpsText =
    gps.verdict === 'noFix'
      ? t('drive.gpsNone')
      : fill(t(gps.verdict === 'ok' ? 'drive.gpsOk' : 'drive.gpsWeak'), { pct: Math.round(gps.fixRatio * 100), max: Math.round(gps.maxKmh ?? 0) })
  const gyroText = {
    ok: fill(t('drive.gyroOk'), { agree: gyro.agree, all }),
    flip: fill(t('drive.gyroFlip'), { disagree: gyro.disagree, all }),
    unclear: fill(t('drive.gyroUnclear'), { agree: gyro.agree, all }),
    notEnough: fill(t('drive.gyroNotEnough'), { n: report.turns.length }),
    noSensor: t('drive.gyroNone'),
  }[gyro.verdict]
  const problem = gyro.verdict === 'flip' || report.stoppedAlarms.length > 0

  return (
    <div className="drive-check">
      <h3>{t('drive.title')}</h3>
      <p className="muted small">{t('drive.help')}</p>
      {report.durationSec < MIN_DRIVE_SEC && <p className="hint small">{t('drive.short')}</p>}
      <ul className="drive-results">
        <li>{gpsText}</li>
        {gps.verdict !== 'noFix' && (
          <li className={report.stoppedAlarms.length > 0 ? 'bad' : ''}>
            {report.stoppedAlarms.length === 0 ? t('drive.stoppedOk') : fill(t('drive.stoppedBad'), { n: report.stoppedAlarms.length })}
          </li>
        )}
        <li className={gyro.verdict === 'flip' ? 'bad' : ''}>
          {gyroText}
          {gyro.source === 'head' && <span className="muted small"> {t('drive.byHead')}</span>}
        </li>
      </ul>
      <button type="button" className={problem ? 'primary' : 'secondary outline'} onClick={() => setSaveFailed(!saveLog(log))}>
        {t('drive.save')}
      </button>
      {saveFailed && <p className="hint small">{t('drive.saveFailed')}</p>}
    </div>
  )
}
