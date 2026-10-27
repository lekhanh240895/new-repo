/**
 * Phone mount position check (plan case A23). During calibration the driver
 * looks at the road, so the calibrated head angle equals how far the phone is
 * to the side. Past ~35° the face is seen from the side and every angle gets
 * less accurate.
 */
import type { CalibrationConfig } from '../config.ts'
import type { Baseline } from './baseline.ts'

export function mountTooFarToSide(baseline: Pick<Baseline, 'yawDeg' | 'approximate'>, cfg: CalibrationConfig): boolean {
  return Number.isFinite(baseline.yawDeg) && Math.abs(baseline.yawDeg) > cfg.maxMountYawDeg
}
