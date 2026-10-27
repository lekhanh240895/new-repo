/**
 * Personal adaptation (docs/ALERT_ACCURACY_PLAN.md, T12). After a trip, parked,
 * the driver can mark an alert as "false". Each mark loosens that family's
 * thresholds a little, up to a hard limit. What never changes (safety floor):
 * phone / lap / center-console budgets, L2 and L3 timing, and anything that
 * would make a must-alarm scenario fail (checked by personal.test.ts).
 *
 * Stored on the device only (platform/personalStore.ts). Never sent anywhere.
 */
import type { Config } from './config.ts'

export type AlertFamily = 'D' | 'L'

export interface Personal {
  version: 1;
  /** "False alarm" marks so far, per family. */
  marksD: number;
  marksL: number;
}

export const DEFAULT_PERSONAL: Readonly<Personal> = Object.freeze({ version: 1, marksD: 0, marksL: 0 })

/**
 * Each mark adds this much; the total is capped per family. The plan allowed up
 * to 20%, but at +15% the scenario library starts missing real distractions
 * (B03, B04, B07–B09, B13, B14) and a microsleep on a bumpy road (F06), so the
 * cap is +10%. personal.test.ts keeps it honest.
 */
export const PERSONAL_STEP = 0.05
export const PERSONAL_MAX_SCALE: Readonly<Record<AlertFamily, number>> = Object.freeze({ D: 1.1, L: 1.1 })

function maxMarks(family: AlertFamily): number {
  return Math.round((PERSONAL_MAX_SCALE[family] - 1) / PERSONAL_STEP)
}

export function scaleFor(p: Personal, family: AlertFamily): number {
  const marks = family === 'D' ? p.marksD : p.marksL
  return Math.min(1 + marks * PERSONAL_STEP, PERSONAL_MAX_SCALE[family])
}

/** True once a family cannot loosen any more. */
export function atLimit(p: Personal, family: AlertFamily): boolean {
  return (family === 'D' ? p.marksD : p.marksL) >= maxMarks(family)
}

export function markFalseAlarm(p: Personal, family: AlertFamily): Personal {
  const cap = (n: number, f: AlertFamily) => Math.min(n + 1, maxMarks(f))
  return family === 'D' ? { ...p, marksD: cap(p.marksD, 'D') } : { ...p, marksL: cap(p.marksL, 'L') }
}

/** Whatever was stored (old version, edited by hand, corrupt) becomes a valid Personal. */
export function parsePersonal(raw: unknown): Personal {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PERSONAL }
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return { ...DEFAULT_PERSONAL }
  const marks = (v: unknown, f: AlertFamily) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), maxMarks(f))) : 0
  return { version: 1, marksD: marks(r.marksD, 'D'), marksL: marks(r.marksL, 'L') }
}

/** The trip config for this driver. The input is not changed. */
export function personalize(cfg: Config, p: Personal): Config {
  const d = scaleFor(p, 'D')
  const l = scaleFor(p, 'L')
  if (d === 1 && l === 1) return cfg
  const b = cfg.budgets
  return {
    ...cfg,
    // Driving looks only. lapMs / consoleMs (phone) stay: the safety floor.
    budgets: {
      ...b,
      mirrorMs: b.mirrorMs * d,
      rearviewMs: b.rearviewMs * d,
      sideMs: b.sideMs * d,
      clusterMs: b.clusterMs * d,
      slowSideMs: b.slowSideMs * d,
      blindSpotMs: b.blindSpotMs * d,
    },
    // L1 and the "drowsy but not closed" rules only. L2 / L3 stay.
    microsleep: { ...cfg.microsleep, l1Ms: cfg.microsleep.l1Ms * l },
    drowsyEyes: { ...cfg.drowsyEyes, heavyMs: cfg.drowsyEyes.heavyMs * l, stareMs: cfg.drowsyEyes.stareMs * l },
  }
}
