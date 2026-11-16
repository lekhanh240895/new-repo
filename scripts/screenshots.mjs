#!/usr/bin/env node
/**
 * Regenerates the install-dialog screenshots in public/screenshots/ from the built app
 * (Vietnamese UI, start screen only: no camera, no faces).
 *
 *   npm run build && npm run screenshots && npm run build
 *
 * The second build copies the new images into dist/.
 */
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'screenshots')

function fail(message) {
  console.error(`screenshots: ${message}`)
  process.exit(1)
}

try {
  await stat(join(root, 'dist', 'index.html'))
} catch {
  fail('no build found. Run "npm run build" first.')
}

const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' })
const url = server.resolvedUrls?.local[0]
if (!url) fail('could not start the preview server')
const browser = await chromium.launch()
let exitCode = 0
try {
  await mkdir(outDir, { recursive: true })

  /** Opens the start screen in Vietnamese, ready for offline use, with permissions allowed. */
  async function open(viewport, deviceScaleFactor) {
    const context = await browser.newContext({ viewport, deviceScaleFactor, locale: 'vi-VN', permissions: ['camera', 'geolocation'] })
    const page = await context.newPage()
    await page.goto(url)
    await page.getByRole('heading', { level: 2 }).first().waitFor()
    // Headless Chromium cannot tell Wi-Fi from mobile data, so the app asks first: download now.
    const download = page.getByRole('button', { name: 'Tải ngay' })
    await download.waitFor({ timeout: 30_000 })
    await download.click()
    await page.getByText('Chạy được khi không có sóng').waitFor({ timeout: 120_000 })
    return { context, page }
  }

  const phone = await open({ width: 360, height: 780 }, 3)
  await phone.page.evaluate(() => window.scrollTo(0, 0))
  await phone.page.screenshot({ path: join(outDir, 'start.png') })
  await phone.page.locator('.ready').scrollIntoViewIfNeeded()
  await phone.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await phone.page.screenshot({ path: join(outDir, 'ready.png') })
  await phone.context.close()

  const wide = await open({ width: 1280, height: 720 }, 1)
  await wide.page.evaluate(() => window.scrollTo(0, 0))
  await wide.page.screenshot({ path: join(outDir, 'wide.png') })
  await wide.context.close()

  console.log(`screenshots written to ${outDir}`)
} catch (err) {
  console.error('screenshots failed:', err instanceof Error ? err.message : err)
  exitCode = 1
} finally {
  await browser.close()
  await new Promise((r) => server.httpServer.close(r))
}
process.exit(exitCode)
