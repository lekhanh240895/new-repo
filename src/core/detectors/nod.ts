/**
 * Head nod (SPEC §10.2): the head drops quickly from level, then comes back.
 * A drop that does not come back is not a nod; the microsleep / head-drop
 * rules handle that case.
 */
import type { FatigueConfig, PoseConfig } from '../config.ts'

export interface NodDetector {
  /** `downDeg`: how far the head is below baseline (positive = down), or null if unknown. Returns true once per nod. */
  update(t: number, downDeg: number | null): boolean;
}

export function createNodDetector(fatigue: FatigueConfig, pose: PoseConfig): NodDetector {
  let lastLevelT: number | null = null
  let droppedAt: number | null = null

  return {
    update(t, downDeg) {
      if (downDeg === null) {
        lastLevelT = null
        droppedAt = null
        return false
      }
      const level = Math.abs(downDeg) <= pose.levelDeg

      if (droppedAt !== null) {
        if (level) {
          droppedAt = null
          lastLevelT = t
          return true
        }
        if (t - droppedAt > fatigue.nodRecoverMs) droppedAt = null
        return false
      }

      if (level) {
        lastLevelT = t
      } else if (
        downDeg >= fatigue.nodDropDeg &&
        lastLevelT !== null &&
        t - lastLevelT <= fatigue.nodDropMaxMs
      ) {
        droppedAt = t
        lastLevelT = null
      }
      return false
    },
  }
}
