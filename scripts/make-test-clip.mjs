#!/usr/bin/env node
/**
 * Writes a tiny synthetic .y4m clip (solid colour, no face) for the CI smoke
 * test. No ffmpeg needed.
 *
 *   node scripts/make-test-clip.mjs <out.y4m> [--luma 16] [--seconds 3]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { luma: { type: 'string', default: '16' }, seconds: { type: 'string', default: '3' } },
})
const out = positionals[0]
if (!out) {
  console.error('usage: make-test-clip.mjs <out.y4m> [--luma 16] [--seconds 3]')
  process.exit(1)
}

const W = 320
const H = 240
const FPS = 15
const luma = Math.max(0, Math.min(255, Number(values.luma)))
const frames = Math.max(1, Math.round(Number(values.seconds) * FPS))

const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)
const frame = Buffer.concat([
  Buffer.from('FRAME\n'),
  Buffer.alloc(W * H, luma), // Y
  Buffer.alloc((W * H) / 2, 128), // U + V (neutral grey)
])

await mkdir(dirname(resolve(out)), { recursive: true })
await writeFile(out, Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]))
console.log(`wrote ${out} (${frames} frames, luma ${luma})`)
