import { dismissInstall, installOffer, promptInstall, useInstallState } from '../../platform/install.ts'
import { MODEL_DOWNLOAD_MB } from '../../platform/offline.ts'
import { usePermission } from '../../platform/permissions.ts'
import { CheckIcon } from '../Icons.tsx'
import type { TextKey } from '../i18n.ts'
import { downloadModel, useOfflineModel } from '../offlineModel.ts'

type T = (k: TextKey) => string

/**
 * "Install the app" on the start screen. Android: one tap opens the system dialog.
 * iPhone: the Share → Add to Home Screen steps. Hidden once installed or dismissed.
 */
export function InstallCard({ t }: { t: T }) {
  const install = useInstallState()
  const offer = installOffer(install)
  if (offer === null) return null
  return (
    <article className="card install-card">
      <p><strong>{t('install.title')}</strong></p>
      <p className="muted small">{t('install.body')}</p>
      {offer === 'iosSteps' && (
        <ol className="small">
          <li>{t('install.ios1')}</li>
          <li>{t('install.ios2')}</li>
          <li>{t('install.ios3')}</li>
        </ol>
      )}
      <div className="install-actions">
        {offer === 'prompt' && (
          <button type="button" onClick={() => void promptInstall()}>{t('install.button')}</button>
        )}
        <button type="button" className="secondary outline" onClick={dismissInstall}>{t('install.later')}</button>
      </div>
    </article>
  )
}

/**
 * "Ready to drive" on the start screen: installed, works offline, camera and location.
 * Each line that is not ready says what to do. Nothing here blocks starting a trip.
 */
export function ReadyChecklist({ t, useLocation }: { t: T; useLocation: boolean }) {
  const install = useInstallState()
  const offline = useOfflineModel()
  const camera = usePermission('camera')
  const location = usePermission('geolocation')

  const item = (ok: boolean, text: string, action?: { label: string; run: () => void }) => (
    <li className={ok ? 'ok' : 'pending'}>
      <span className="tick">{ok ? <CheckIcon size={16} /> : null}</span>
      <span>
        {text}
        {action && (
          <>
            {' '}
            <button type="button" className="link" onClick={action.run}>{action.label}</button>
          </>
        )}
      </span>
    </li>
  )
  const total = String(MODEL_DOWNLOAD_MB)
  const download = () => void downloadModel()

  return (
    <article className="card ready">
      <p><strong>{t('ready.title')}</strong></p>
      <ul className="checklist">
        {item(install.installed, t(install.installed ? 'ready.installed' : 'ready.notInstalled'))}
        {offline.kind === 'ready' && item(true, t('ready.offline'))}
        {offline.kind === 'checking' && item(false, t('ready.offlineChecking'))}
        {offline.kind === 'downloading' &&
          item(false, t('ready.offlineDownloading').replace('{mb}', String(offline.mb)).replace('{total}', total))}
        {offline.kind === 'needsDownload' &&
          item(false, t('ready.offlineNeeds').replace('{total}', total), { label: t('ready.offlineDownload'), run: download })}
        {offline.kind === 'failed' && item(false, t('ready.offlineFailed'), { label: t('ready.offlineRetry'), run: download })}
        {offline.kind === 'unsupported' && item(false, t('ready.offlineUnsupported'))}
        {camera !== 'unknown' &&
          item(camera === 'granted', t(camera === 'granted' ? 'ready.cameraOk' : camera === 'denied' ? 'ready.cameraDenied' : 'ready.cameraAsk'))}
        {useLocation &&
          location !== 'unknown' &&
          item(location === 'granted', t(location === 'granted' ? 'ready.locationOk' : location === 'denied' ? 'ready.locationDenied' : 'ready.locationAsk'))}
      </ul>
    </article>
  )
}
