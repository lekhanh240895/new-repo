#!/usr/bin/env node
/**
 * Replay harness (SPEC §15): plays a video file as a fake camera in Chromium,
 * runs the real app pipeline on it, and saves every frame's numbers as JSON.
 *
 *   npm run build
 *   npm run replay -- --clip clips/blink-test.y4m [--seconds 10] [--out replay-out/blink-test.json]
 *                     [--params "delegate=cpu&worker=0"] [--headed]
 *
 * Clips must be .y4m or .mjpeg. Convert with:
 *   ffmpeg -i input.mp4 -vf scale=640:480 -r 30 -pix_fmt yuv420p clips/name.y4m
 *
 * Never commit clips of real people to the repo (clips/ is git-ignored).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`replay: ${message}`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    clip: { type: 'string' },
    seconds: { type: 'string', default: '10' },
    out: { type: 'string' },
    headed: { type: 'boolean', default: false },
    /** Extra URL params, for example "delegate=cpu&worker=0". */
    params: { type: 'string' },
    /** Fail unless this sensor state was seen at least once (smoke tests). */
    'expect-sensor': { type: 'string' },
  },
})

if (!values.clip) fail('missing --clip <file.y4m|file.mjpeg>')
const clip = resolve(values.clip)
if (!['.y4m', '.mjpeg'].includes(extname(clip))) fail('clip must be .y4m or .mjpeg (see the ffmpeg hint in this file)')
const seconds = Number(values.seconds)
if (!(seconds > 0)) fail('--seconds must be a positive number')
const out = resolve(values.out ?? join(root, 'replay-out', `${basename(clip, extname(clip))}.json`))

try {
  await stat(clip)
} catch {
  fail(`clip not found: ${clip}`)
}
try {
  await stat(join(root, 'dist', 'index.html'))
} catch {
  fail('no build found. Run "npm run build" first.')
}

const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' })
const url = server.resolvedUrls?.local[0]
if (!url) fail('could not start the preview server')

const browser = await chromium.launch({
  headless: !values.headed,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${clip}`,
  ],
})

let exitCode = 0
try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  page.on('console', (m) => {
    // MediaPipe writes normal INFO/W0000 logs through console.error; skip those.
    if (m.type() === 'error' && !/^(INFO:|[IW]\d{4} )/.test(m.text())) consoleErrors.push(m.text())
  })

  await page.goto(`${url}?replay${values.params ? `&${values.params}` : ''}`)
  await page.getByRole('button', { name: 'Start camera' }).click()
  await page.waitForFunction(() => window.__biomonitorReplay?.backend != null || (window.__biomonitorReplay?.errors.length ?? 0) > 0, null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(seconds * 1000)

  const data = await page.evaluate(() => window.__biomonitorReplay)
  if (!data) throw new Error('page did not expose replay data')

  const samples = data.samples
  const found = samples.filter((s) => s.raw.faceFound).length
  const mean = (xs) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length)
  const sensors = {}
  for (const s of samples) sensors[s.sensor] = (sensors[s.sensor] ?? 0) + 1
  const summary = {
    clip: basename(clip),
    backend: data.backend,
    frames: samples.length,
    faceFoundRatio: samples.length === 0 ? 0 : found / samples.length,
    meanInferMs: mean(samples.map((s) => s.raw.inferMs)),
    meanFps: mean(samples.slice(-30).map((s) => s.fps)),
    sensors,
    errors: [...data.errors, ...consoleErrors],
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify({ summary, samples }, null, 1))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`trace written to ${out}`)
  if (samples.length === 0 || summary.errors.length > 0) exitCode = 1
  const expected = values['expect-sensor']
  if (expected && !(sensors[expected] > 0)) {
    console.error(`replay: expected sensor state ${expected} was never seen`)
    exitCode = 1
  }
} catch (err) {
  console.error('replay failed:', err instanceof Error ? err.message : err)
  exitCode = 1
} finally {
  await browser.close()
  await new Promise((r) => server.httpServer.close(r))
}
process.exit(exitCode)
