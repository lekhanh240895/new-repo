#!/usr/bin/env node
/**
 * Offline check (SPEC §2.1 goal 4): load the built app once (the service worker
 * caches the app shell; the model and wasm are cached when first used), go
 * offline, reload, and start the vision pipeline again.
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
} catch (err) {
  console.error('offline check failed:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
  await new Promise((r) => server.httpServer.close(r))
}
process.exit(ok ? 0 : 1)
