#!/usr/bin/env node
/**
 * Real-clip validation (P7, docs/P7_RECORDING_GUIDE.md). For each clip in
 * clips/manifest.json: convert it to .y4m (ffmpeg), play it as a fake camera
 * through the real MediaPipe model (scripts/replay.mjs), then judge the frames
 * with the same code as the synthetic scenarios.
 *
 *   npm run clips                 # all clips → clips/CLIP_REPORT.md
 *   npm run clips -- --only C04   # one clip
 *   npm run clips -- --fresh      # ignore cached replays
 *   npm run clips -- --gpu        # use the GPU model (default CPU: same on every machine)
 *   npm run clips -- --share      # also write clips/share/<id>.json: per-frame numbers only
 *                                 # (eye openness, head angles, …), no landmark points
 *
 * Everything stays in clips/ and replay-out/, which git ignores: the clips show a real face.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { checkClip, signCheck, type ClipResult, type SignFinding } from '../src/clips/check.ts'
import { parseManifest, type ClipEntry } from '../src/clips/manifest.ts'
import type { FrameResult } from '../src/core/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clipsDir = join(root, 'clips')
const workDir = join(root, 'replay-out', 'clips')
const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    fresh: { type: 'boolean', default: false },
    gpu: { type: 'boolean', default: false },
    share: { type: 'boolean', default: false },
  },
})

const manifestPath = join(clipsDir, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`No ${manifestPath}.\nCopy docs/clips.manifest.example.json to clips/manifest.json and follow docs/P7_RECORDING_GUIDE.md.`)
  process.exit(1)
}
let rawManifest: unknown
try {
  rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error(`clips/manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
const { manifest, errors } = parseManifest(rawManifest)
for (const e of errors) console.error(`manifest: ${e}`)
const entries = manifest.clips.filter((c) => values.only === undefined || c.id === values.only)
if (entries.length === 0) {
  console.error(values.only ? `no clip ${values.only} in the manifest` : 'no valid clips in the manifest')
  process.exit(1)
}
mkdirSync(workDir, { recursive: true })

const newer = (a: string, b: string) => existsSync(a) && existsSync(b) && statSync(a).mtimeMs >= statSync(b).mtimeMs

/** A .y4m the fake camera can play: the clip itself, or an ffmpeg conversion (640 px wide, 15 fps). */
function toY4m(entry: ClipEntry): string {
  const src = join(clipsDir, entry.file)
  if (!existsSync(src)) throw new Error(`file not found: clips/${entry.file}`)
  if (extname(src).toLowerCase() === '.y4m') return src
  const out = join(workDir, `${entry.id}.y4m`)
  if (!values.fresh && newer(out, src)) return out
  // Arguments as a list (no shell): file names cannot inject commands.
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=640:-2,fps=15', '-pix_fmt', 'yuv420p', out], { stdio: 'inherit' })
  if (r.error) throw new Error(`ffmpeg is needed to convert ${entry.file}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`ffmpeg could not convert ${entry.file}`)
  return out
}

/** Seconds of video in a .y4m (header + fixed-size frames). */
function y4mSeconds(path: string): number {
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(256)
  readSync(fd, head, 0, 256, 0)
  closeSync(fd)
  const line = head.toString('latin1').split('\n')[0] ?? ''
  const num = (k: string) => Number(new RegExp(`\\s${k}(\\d+)`).exec(line)?.[1])
  const w = num('W')
  const h = num('H')
  const fps = /\sF(\d+):(\d+)/.exec(line)
  if (!w || !h || !fps) throw new Error(`not a y4m file: ${path}`)
  const frameBytes = 'FRAME\n'.length + (w * h * 3) / 2
  const frames = Math.floor((statSync(path).size - line.length - 1) / frameBytes)
  return frames / (Number(fps[1]) / Number(fps[2]))
}

/** Real-model frames for the clip (cached next to the .y4m). */
function replay(entry: ClipEntry, y4m: string): { samples: FrameResult[]; videoStartT: number | undefined } {
  const out = join(workDir, `${entry.id}.json`)
  if (values.fresh || !newer(out, y4m)) {
    // Stop just before the end: the fake camera loops the file.
    const seconds = Math.max(1, y4mSeconds(y4m) - 0.3).toFixed(1)
    const args = ['scripts/replay.mjs', '--clip', y4m, '--seconds', seconds, '--out', out, ...(values.gpu ? [] : ['--params', 'delegate=cpu'])]
    const r = spawnSync(process.execPath, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
    if (r.status !== 0 && !existsSync(out)) throw new Error('replay failed (see the messages above)')
  }
  const data = JSON.parse(readFileSync(out, 'utf8')) as {
    summary: { cameraRequestedAt?: number | null; cameraOpenedAt?: number | null };
    samples: { raw: FrameResult }[];
  }
  // Chromium's fake camera starts the video when the camera is requested (measured: blinks
  // land within 0.02 s of their place in the video).
  return { samples: data.samples.map((s) => s.raw), videoStartT: data.summary.cameraRequestedAt ?? data.summary.cameraOpenedAt ?? undefined }
}

/**
 * Numbers to send for tuning instead of video: clip-relative time and the model's numbers,
 * without debugPoints (landmark positions, which describe the face shape).
 */
function share(entry: ClipEntry, samples: readonly FrameResult[], videoStartT: number | undefined) {
  const t0 = videoStartT ?? samples[0]?.t ?? 0
  const frames = samples.map(({ debugPoints: _drop, ...f }) => ({ ...f, t: Math.round(f.t - t0) }))
  mkdirSync(join(clipsDir, 'share'), { recursive: true })
  writeFileSync(join(clipsDir, 'share', `${entry.id}.json`), JSON.stringify({ entry, frames }))
}

const results: { entry: ClipEntry; result?: ClipResult; signs?: SignFinding[]; error?: string }[] = []
for (const entry of entries) {
  process.stdout.write(`${entry.id} … `)
  try {
    const { samples, videoStartT } = replay(entry, toY4m(entry))
    if (values.share) share(entry, samples, videoStartT)
    if (entry.signCheck) {
      const signs = signCheck(samples, entry.signCheck, undefined, videoStartT)
      results.push({ entry, signs })
      console.log(signs.some((s) => s.ok === false) ? 'SIGN MISMATCH' : signs.some((s) => s.ok === null) ? 'partly unknown' : 'signs ok')
    } else {
      const result = checkClip(samples, entry, undefined, videoStartT)
      results.push({ entry, result })
      console.log(result.status.toUpperCase() + (result.reasons.length ? ` — ${result.reasons.join('; ')}` : ''))
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    results.push({ entry, error })
    console.log(`ERROR — ${error}`)
  }
}

const lines = [
  '# Clip report',
  '',
  'Generated by `npm run clips` (P7). Stays in clips/ (git-ignored). Only numbers, no images.',
  '',
  '| Clip | Result | Calibration | Face found | What the app did (s from video start) | Why it failed |',
  '| --- | --- | --- | --- | --- | --- |',
  ...results.filter((r) => !r.signs).map(({ entry, result, error }) =>
    result
      ? `| ${entry.id}${entry.title ? ` — ${entry.title}` : ''} | ${result.status === 'pass' ? '✅ pass' : '❌ fail'} | ${result.calibration} | ${Math.round(result.faceFoundRatio * 100)}% | ${result.timeline.join(', ') || '(nothing)'} | ${result.reasons.join('; ')} |`
      : `| ${entry.id} | ⚠️ error | | | | ${error ?? ''} |`),
  '',
]
for (const { entry, signs } of results.filter((r) => r.signs)) {
  lines.push(`## Sign check: ${entry.id}`, '', '| Setting | Measured | Current | Should be | OK |', '| --- | --- | --- | --- | --- |')
  for (const s of signs ?? []) lines.push(`| \`${s.setting}\` | ${s.measured} | ${s.current} | ${s.recommended ?? '?'} | ${s.ok === null ? 'cannot tell' : s.ok ? '✅' : '❌ change it'} |`)
  lines.push('')
}
writeFileSync(join(clipsDir, 'CLIP_REPORT.md'), lines.join('\n'))
console.log('report written to clips/CLIP_REPORT.md')
const bad = results.some((r) => r.error || r.result?.status === 'fail' || r.signs?.some((s) => s.ok === false))
process.exit(bad ? 1 : 0)
