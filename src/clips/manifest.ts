/**
 * Real-clip validation (docs/ALERT_ACCURACY_PLAN.md, P7). The driver records
 * short clips of themselves (parked, or at a desk) and describes each one in
 * clips/manifest.json: when to calibrate, named moments, and what the app
 * should do. The manifest is hand-written, so it is checked field by field.
 *
 * Clips and the manifest stay in clips/, which git ignores: they show a real face.
 */
import type { Expectation } from '../scenarios/types.ts'

export interface SpeedChange {
  /** Seconds from the start of the clip. */
  at: number;
  kmh: number | null;
}

/** Time windows (seconds) for the sign check: what the driver did when. */
export interface SignWindows {
  straight: [number, number];
  headRight?: [number, number];
  headDown?: [number, number];
  eyesRight?: [number, number];
  eyesDown?: [number, number];
}

export interface ClipEntry {
  /** Usually the plan case it checks, e.g. "C03". */
  id: string;
  /** File inside clips/ (.y4m, or any video ffmpeg can read). */
  file: string;
  title?: string;
  /** Seconds used to calibrate (look at the road, blink normally). Default [0, 8]. */
  calibrate: [number, number];
  /** GPS speed for the whole clip (default 60), changed at the given times. */
  speed: SpeedChange[];
  /** Named moments, seconds from the start of the clip. */
  marks: Record<string, number>;
  expect: Expectation[];
  /** Present for a sign-check clip instead of `expect`. */
  signCheck?: SignWindows;
}

export interface Manifest {
  clips: ClipEntry[];
}

const KINDS = new Set(['noAlarm', 'alarm', 'level', 'noLevel', 'advisory', 'noAdvisory', 'stops', 'deescalates', 'maxAlarms', 'chime', 'speaks'])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isWindow = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] >= 0 && v[1] > v[0]

/** A plain file name inside clips/: no folders, no "..", no absolute paths. */
export function isSafeClipFile(name: string): boolean {
  return /^[\w.-]+$/.test(name) && !name.startsWith('.') && name.length <= 120
}

/** Returns the valid clips, plus one message per problem (a bad entry is skipped, not guessed). */
export function parseManifest(raw: unknown): { manifest: Manifest; errors: string[] } {
  const errors: string[] = []
  const clips: ClipEntry[] = []
  if (!isObj(raw) || !Array.isArray(raw.clips)) return { manifest: { clips }, errors: ['manifest must be { "clips": [ … ] }'] }

  raw.clips.forEach((c: unknown, i: number) => {
    const where = `clips[${i}]`
    if (!isObj(c)) return void errors.push(`${where}: not an object`)
    const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : null
    if (id === null) return void errors.push(`${where}: "id" must be letters, digits, - or _`)
    const at = `${where} (${id})`
    if (typeof c.file !== 'string' || !isSafeClipFile(c.file)) return void errors.push(`${at}: "file" must be a plain file name inside clips/`)
    const calibrate = c.calibrate === undefined ? ([0, 8] as [number, number]) : isWindow(c.calibrate) ? c.calibrate : null
    if (calibrate === null) return void errors.push(`${at}: "calibrate" must be [startSec, endSec]`)

    const speed: SpeedChange[] = []
    if (c.speed !== undefined) {
      if (!Array.isArray(c.speed)) return void errors.push(`${at}: "speed" must be a list of { "at": sec, "kmh": number | null }`)
      for (const s of c.speed) {
        if (!isObj(s) || !isNum(s.at) || !(s.kmh === null || isNum(s.kmh))) return void errors.push(`${at}: bad "speed" entry`)
        speed.push({ at: s.at, kmh: s.kmh as number | null })
      }
    }

    const marks: Record<string, number> = {}
    if (c.marks !== undefined) {
      if (!isObj(c.marks)) return void errors.push(`${at}: "marks" must be { "name": seconds }`)
      for (const [k, v] of Object.entries(c.marks)) {
        if (!isNum(v) || v < 0) return void errors.push(`${at}: mark "${k}" must be seconds ≥ 0`)
        marks[k] = v
      }
    }

    if (c.signCheck !== undefined) {
      const w = c.signCheck
      if (!isObj(w) || !isWindow(w.straight)) return void errors.push(`${at}: "signCheck.straight" must be [startSec, endSec]`)
      const windows: SignWindows = { straight: w.straight }
      for (const k of ['headRight', 'headDown', 'eyesRight', 'eyesDown'] as const) {
        if (w[k] === undefined) continue
        if (!isWindow(w[k])) return void errors.push(`${at}: "signCheck.${k}" must be [startSec, endSec]`)
        windows[k] = w[k]
      }
      clips.push({ id, file: c.file, calibrate, speed, marks, expect: [], signCheck: windows, ...(typeof c.title === 'string' && { title: c.title }) })
      return
    }

    if (!Array.isArray(c.expect) || c.expect.length === 0) return void errors.push(`${at}: "expect" must list what the app should do`)
    for (const e of c.expect) {
      if (!isObj(e) || typeof e.kind !== 'string' || !KINDS.has(e.kind)) return void errors.push(`${at}: unknown expectation ${JSON.stringify(e)}`)
      for (const key of ['after', 'from', 'to'] as const) {
        const m = e[key]
        if (m !== undefined && (typeof m !== 'string' || !(m in marks))) return void errors.push(`${at}: "${key}" refers to an unknown mark "${String(m)}"`)
      }
      if (e.within !== undefined && !(isNum(e.within) && e.within > 0)) return void errors.push(`${at}: "within" must be milliseconds > 0`)
    }
    clips.push({ id, file: c.file, calibrate, speed, marks, expect: c.expect as Expectation[], ...(typeof c.title === 'string' && { title: c.title }) })
  })
  return { manifest: { clips }, errors }
}
