/** Small statistics helpers. Pure. */

/** Linear-interpolated quantile (q in 0..1). NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (xs.length === 0) return Number.NaN
  const pos = Math.min(1, Math.max(0, q)) * (xs.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = xs[lo] ?? Number.NaN
  const b = xs[hi] ?? a
  return a + (b - a) * (pos - lo)
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
