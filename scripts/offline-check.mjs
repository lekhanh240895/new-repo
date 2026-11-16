#!/usr/bin/env node
/**
 * Offline check (SPEC §2.1 goal 4): load the built app once (the service worker
 * caches the app shell; the model and wasm are cached when first used), go
 * offline, reload, and start the vision pipeline again.
 *
 * Second part (PWA): a driver who installs the app and never starts a trip online uses the
 * "Download for offline" button (or the automatic Wi-Fi download); the first trip may then
 * be started with no signal at all. The model must come from the downloaded copy.
 *
 *   npm run build && node scripts/offline-check.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Fail instead of hanging (for example when the service worker never installs). */
function within(ms, what, promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)),
  ])
}
const clip = join(root, 'replay-out', 'smoke-dark.y4m')

const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' })
const url = server.resolvedUrls?.local[0]
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`],
})

let ok = false
let downloadOk = false
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  const startCamera = async () => {
    await page.getByRole('button', { name: 'Start camera' }).click()
    await page.waitForFunction(
      () => window.__biomonitorReplay?.backend != null || (window.__biomonitorReplay?.errors.length ?? 0) > 0,
      null,
      { timeout: 60_000 },
    )
    await page.waitForTimeout(1500)
    return page.evaluate(() => ({
      backend: window.__biomonitorReplay?.backend ?? null,
      frames: window.__biomonitorReplay?.samples.length ?? 0,
      errors: window.__biomonitorReplay?.errors ?? [],
    }))
  }

  // 1. Online: install the service worker and use the model once.
  await page.goto(`${url}?replay&delegate=cpu`)
  await within(30_000, 'service worker install', page.evaluate(() => navigator.serviceWorker.ready))
  await page.reload() // make sure the page is controlled by the service worker
  const online = await startCamera()
  console.log('online :', online)

  // 2. Offline: reload and run again from the caches.
  await context.setOffline(true)
  await page.reload()
  const offline = await startCamera()
  console.log('offline:', offline)

  ok = offline.backend !== null && offline.frames > 0 && offline.errors.length === 0 && errors.length === 0
  if (!ok) console.error('offline check failed', { errors })
  else console.log('offline check passed')

  // 3. A fresh browser that never ran a trip: download for offline, go offline, start a trip.
  const fresh = await browser.newContext()
  const tripPage = await fresh.newPage()
  const tripErrors = []
  tripPage.on('pageerror', (e) => tripErrors.push(e.message))
  await tripPage.goto(`${url}?replay&tab=trip`)
  await tripPage.getByRole('button', { name: 'Download now' }).click({ timeout: 40_000 })
  await within(120_000, 'offline download', tripPage.getByText('Works without signal').waitFor())
  await fresh.setOffline(true)
  await tripPage.reload()
  await within(30_000, 'offline reload', tripPage.getByText('Works without signal').waitFor())
  await tripPage.getByLabel('I understand').check()
  await tripPage.getByRole('button', { name: 'Start trip' }).click()
  // The CI clip has no face, so the trip cannot reach MONITORING: what matters is that the model
  // loaded from the downloaded copy (a backend is set) and did not fail ("model failed to load").
  await within(
    120_000,
    'offline model load',
    tripPage
      .waitForFunction(() => {
        const s = window.__biomonitorTrip?.snapshot()
        return s !== undefined && (s.backend !== null || s.log.some((l) => /failed/.test(l)))
      })
      .then((h) => h.jsonValue()),
  )
  const trip = await tripPage.evaluate(() => {
    const s = window.__biomonitorTrip.snapshot()
    return { backend: s.backend, modelFailed: s.log.some((l) => /model failed|engine failed/.test(l)) }
  })
  console.log('offline trip after download:', trip)
  downloadOk = trip.backend !== null && !trip.modelFailed && tripErrors.length === 0
  if (!downloadOk) console.error('offline trip after download failed', { tripErrors, trip })
  else console.log('offline trip after download passed')
} catch (err) {
  console.error('offline check failed:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
  await new Promise((r) => server.httpServer.close(r))
}
process.exit(ok && downloadOk ? 0 : 1)
