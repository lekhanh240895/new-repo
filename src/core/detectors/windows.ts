/** Sliding time windows used by the fatigue detectors (SPEC §10.2). Pure state, no timers. */

export interface EventCounter {
  add(t: number): void;
  /** Events in the window ending at `t`. */
  count(t: number): number;
}

export function createEventCounter(windowMs: number): EventCounter {
  let times: number[] = []
  return {
    add(t) {
      times.push(t)
    },
    count(t) {
      times = times.filter((x) => x > t - windowMs)
      return times.length
    },
  }
}

export interface Perclos {
  /** `closed: null` = this frame could not be judged (counts as invalid). */
  add(t: number, closed: boolean | null): void;
  /**
   * Share of valid frames with eyes closed over the window, or null until the
   * window is full and enough frames were valid.
   */
  value(t: number): number | null;
}

export function createPerclos(windowMs: number, minValidRatio: number): Perclos {
  let entries: { t: number; closed: boolean | null }[] = []
  let firstT: number | null = null
  return {
    add(t, closed) {
      firstT ??= t
      entries.push({ t, closed })
    },
    value(t) {
      entries = entries.filter((e) => e.t > t - windowMs)
      if (firstT === null || t - firstT < windowMs * 0.9 || entries.length === 0) return null
      const valid = entries.filter((e) => e.closed !== null)
      if (valid.length / entries.length < minValidRatio) return null
      return valid.filter((e) => e.closed === true).length / valid.length
    },
  }
}
