/**
 * Self-improve loop (docs/ALERT_ACCURACY_PLAN.md, T13). Moves one config value
 * at a time, replays the whole scenario library, and finds the range in which
 * nothing that passes today breaks. A must-alarm case (alarm, advisory, stop…)
 * is a hard limit: a variant that misses one is never "better".
 *
 * Pure (no file system); scripts/tune.ts writes the report.
 */
import { DEFAULT_CONFIG, type Config } from '../core/config.ts'
import { runScenario, SCENARIOS } from './index.ts'
import type { Scenario } from './types.ts'

/** Config values worth tuning, as dotted paths into Config. */
export const TUNABLE: readonly string[] = [
  'attention.capacityMs',
  'attention.refillLatencyMs',
  'budgets.mirrorMs',
  'budgets.rearviewMs',
  'budgets.sideMs',
  'budgets.clusterMs',
  'budgets.lapMs',
  'budgets.slowSideMs',
  'budgets.blindSpotMs',
  'budgets.escalateMs',
  'microsleep.l1Ms',
  'microsleep.blindGraceMs',
  'eye.closedBelow',
  'eye.downGazeCorrection',
  'expression.extraMs',
  'drowsyEyes.heavyBelow',
  'drowsyEyes.heavyMs',
  'drowsyEyes.nearMissMinMs',
  'zones.roadYaw',
  'zones.downPitch',
  'faceLoss.turnAwayRateDegS',
  'alert.distractionRecoveryMs',
]

export const FACTORS: readonly number[] = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2, 1.3, 1.5]

const MUST_ALARM_KINDS = new Set(['alarm', 'level', 'advisory', 'stops', 'deescalates', 'chime'])

/** A case where the app must DO something: missing it is the worst outcome. */
export function isMustAlarm(s: Scenario): boolean {
  return (s.expect ?? []).some((e) => MUST_ALARM_KINDS.has(e.kind))
}

export function getPath(cfg: Config, path: string): number {
  let v: unknown = cfg
  for (const key of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[key]
  if (typeof v !== 'number') throw new Error(`not a number config value: ${path}`)
  return v
}

/** A copy of `cfg` with one value changed. */
export function withValue(cfg: Config, path: string, value: number): Config {
  getPath(cfg, path)
  const copy = structuredClone(cfg) as Config
  const keys = path.split('.')
  const last = keys.pop()
  let obj = copy as unknown as Record<string, unknown>
  for (const key of keys) obj = obj[key] as Record<string, unknown>
  if (last === undefined) throw new Error(`bad path: ${path}`)
  obj[last] = value
  return copy
}

export interface LibraryRun {
  passed: Set<string>;
  failed: Set<string>;
  /** Must-alarm cases that failed. */
  misses: string[];
}

export function runLibrary(cfg: Config = DEFAULT_CONFIG, scenarios: readonly Scenario[] = SCENARIOS): LibraryRun {
  const passed = new Set<string>()
  const failed = new Set<string>()
  const misses: string[] = []
  for (const s of scenarios) {
    const r = runScenario(s, cfg)
    if (r.status === 'pass') passed.add(s.id)
    else if (r.status === 'fail') {
      failed.add(s.id)
      if (isMustAlarm(s)) misses.push(s.id)
    }
  }
  return { passed, failed, misses }
}

export interface SweepPoint {
  factor: number;
  value: number;
  /** Cases that passed with the default config and fail with this value. */
  broken: string[];
  /** Cases that failed with the default config and pass with this value. */
  fixed: string[];
  misses: string[];
}

export interface Sweep {
  path: string;
  value: number;
  points: SweepPoint[];
  /** Widest factors around 1.0 where nothing breaks (1 = no room on that side). */
  safeLow: number;
  safeHigh: number;
}

export function sweep(path: string, base: LibraryRun, cfg: Config = DEFAULT_CONFIG, factors: readonly number[] = FACTORS): Sweep {
  const value = getPath(cfg, path)
  const points = factors.map((factor): SweepPoint => {
    const run = runLibrary(withValue(cfg, path, value * factor))
    return {
      factor,
      value: value * factor,
      broken: [...base.passed].filter((id) => run.failed.has(id)),
      fixed: [...base.failed].filter((id) => run.passed.has(id)),
      misses: run.misses,
    }
  })
  let safeLow = 1
  for (const p of [...points].filter((x) => x.factor < 1).sort((a, b) => b.factor - a.factor)) {
    if (p.broken.length > 0) break
    safeLow = p.factor
  }
  let safeHigh = 1
  for (const p of [...points].filter((x) => x.factor > 1).sort((a, b) => a.factor - b.factor)) {
    if (p.broken.length > 0) break
    safeHigh = p.factor
  }
  return { path, value, points, safeLow, safeHigh }
}

/**
 * Greedy search: keep any single change that passes more cases with no new
 * must-alarm miss and nothing broken. Returns the changes (empty = the
 * defaults are already the best the library can tell).
 */
export function suggest(sweeps: readonly Sweep[]): { path: string; from: number; to: number; fixed: string[] }[] {
  const out: { path: string; from: number; to: number; fixed: string[] }[] = []
  for (const s of sweeps) {
    const best = s.points
      .filter((p) => p.broken.length === 0 && p.fixed.length > 0)
      .sort((a, b) => b.fixed.length - a.fixed.length || Math.abs(a.factor - 1) - Math.abs(b.factor - 1))[0]
    if (best) out.push({ path: s.path, from: s.value, to: best.value, fixed: best.fixed })
  }
  return out
}
