/**
 * System notifications (SPEC §12 F10): when the app is hidden, sound may not
 * play, so a notification tells the driver that monitoring has paused.
 */

/** Ask for permission. Call from a tap. Resolves false if refused or unsupported. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Show a notification. Uses the service worker (required on Android), else the page API. */
export function showNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const options: NotificationOptions = { body, tag: 'biomonitor-paused', icon: 'icons/icon-192.png' }
  const viaPage = () => {
    try {
      new Notification(title, options)
    } catch (err) {
      console.warn('BioMonitor: notification failed', err)
    }
  }
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller !== null) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(viaPage)
  } else {
    viaPage()
  }
}
