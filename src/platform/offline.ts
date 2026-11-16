/**
 * Offline readiness for the face model (~18 MB). The service worker caches the
 * app shell at install, but the model only on first use, so a driver who
 * installs the app and then starts a trip with no signal would have no model.
 * This downloads the model ahead of time, into the same cache the service
 * worker reads from (vite.config.ts: MODEL_CACHE, CacheFirst).
 */

export type ConnectionKind = 'wifi' | 'cellular' | 'unknown'

interface NetworkInformationLike {
  type?: string;
  saveData?: boolean;
}

/** Wi-Fi (or cable), mobile data, or unknown. "Data saver" on counts as mobile data. */
export function connectionKind(connection: NetworkInformationLike | undefined): ConnectionKind {
  if (connection === undefined) return 'unknown'
  if (connection.saveData === true) return 'cellular'
  if (connection.type === 'wifi' || connection.type === 'ethernet') return 'wifi'
  if (connection.type === 'cellular') return 'cellular'
  return 'unknown'
}

/** Decision (2026-11): download by itself only on Wi-Fi. Mobile data or unknown (iPhone): ask first. */
export function autoDownloadAllowed(kind: ConnectionKind): boolean {
  return kind === 'wifi'
}

export function currentConnection(): ConnectionKind {
  if (typeof navigator === 'undefined') return 'unknown'
  return connectionKind((navigator as Navigator & { connection?: NetworkInformationLike }).connection)
}

/** Can this browser keep files for offline use? (Not in dev mode, where there is no service worker.) */
export function offlineSupported(): boolean {
  return !import.meta.env.DEV && typeof caches !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export const MODEL_CACHE: string = __MODEL_CACHE__
export const MODEL_DOWNLOAD_MB: number = __MODEL_DOWNLOAD_MB__

/** True when every file is already in the model cache. */
export async function filesCached(files: readonly string[]): Promise<boolean> {
  const cache = await caches.open(MODEL_CACHE)
  const hits = await Promise.all(files.map((f) => cache.match(f)))
  return hits.every((r) => r !== undefined)
}

/**
 * Downloads the files that are not cached yet and stores them in the model cache.
 * `onProgress` gets the bytes received so far. Throws on a network or storage error;
 * files already stored stay stored, so a retry continues where it stopped.
 */
export async function downloadFiles(files: readonly string[], onProgress: (bytes: number) => void): Promise<void> {
  const cache = await caches.open(MODEL_CACHE)
  let received = 0
  for (const url of files) {
    if ((await cache.match(url)) !== undefined) continue
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok || response.body === null) throw new Error(`download failed: ${url} (${response.status})`)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      onProgress(received)
    }
    // Same headers as the network response, so the service worker serves it as if it had cached it.
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    // "Vary: Origin" would make the copy match only requests that carry the same Origin header as
    // this one. The worker's module import is a CORS request (it has one), this download is not, so
    // the copy would be missed and an offline trip would fail. The files are static: ignore Vary.
    headers.delete('vary')
    await cache.put(url, new Response(new Blob(chunks as BlobPart[]), { status: 200, headers }))
  }
}

/** Removes model caches of older app versions (each holds ~18 MB). */
export async function removeOldModelCaches(): Promise<void> {
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.startsWith('biomonitor-model-') && n !== MODEL_CACHE).map((n) => caches.delete(n)))
}

/** Asks the browser not to clear the app's files when space runs low. Returns true when granted. */
export async function persistStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist === undefined) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
