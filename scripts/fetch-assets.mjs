#!/usr/bin/env node
/**
 * Puts the MediaPipe model and wasm files into public/ so the app never
 * loads them from a CDN at runtime (SPEC §14.2), then checks every file
 * against the SHA-256 hashes in assets.lock.json.
 *
 *   node scripts/fetch-assets.mjs           # fetch / copy + verify
 *   node scripts/fetch-assets.mjs --update  # rewrite hashes (after a version bump; review the diff!)
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(root, 'assets.lock.json')
const update = process.argv.includes('--update')

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function exists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

async function main() {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const problems = []

  for (const asset of lock.assets) {
    const dest = join(root, asset.dest)
    await mkdir(dirname(dest), { recursive: true })

    if (asset.from) {
      await copyFile(join(root, asset.from), dest)
    } else if (asset.url) {
      const ok = (await exists(dest)) && (update || (await sha256(dest)) === asset.sha256)
      if (!ok) {
        console.log(`downloading ${asset.url}`)
        await download(asset.url, dest)
      }
    } else {
      throw new Error(`asset ${asset.dest} needs "from" or "url"`)
    }

    const hash = await sha256(dest)
    if (update) {
      asset.sha256 = hash
    } else if (hash !== asset.sha256) {
      problems.push(`${asset.dest}: expected ${asset.sha256}, got ${hash}`)
    }
  }

  if (update) {
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    console.log('assets.lock.json updated. Review the diff before committing.')
    return
  }
  if (problems.length > 0) {
    console.error('Asset hash mismatch — refusing to continue:\n  ' + problems.join('\n  '))
    console.error('If you bumped @mediapipe/tasks-vision on purpose, run with --update and review.')
    process.exit(1)
  }
  console.log(`assets ok (${lock.assets.length} files verified)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
