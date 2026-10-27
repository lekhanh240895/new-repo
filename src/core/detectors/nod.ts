/**
 * Head nod (SPEC §10.2): the head drops quickly from level, then comes back.
 * A drop that does not come back is not a nod; the microsleep / head-drop
 * rules handle that case.
 *
 * T11: a fatigue nod also needs drowsy eyes (closed, or heavy lids while not
 * looking down) at some point during the drop. Bumps, hard braking, nodding to
 * music and glancing down at a phone move the head the same way, but with the
 * eyes open (E06–E08, E11).
 */
import type { FatigueConfig, PoseConfig } from '../config.ts'

export interface NodDetector {
  /**
   * `downDeg`: how far the head is below baseline (positive = down), or null if unknown.
   * `drowsyEyes`: the eyes look drowsy in this frame. Returns true once per nod.
   */
  update(t: number, downDeg: number | null, drowsyEyes: boolean): boolean;
}

export function createNodDetector(fatigue: FatigueConfig, pose: PoseConfig): NodDetector {
  let lastLevelT: number | null = null
  let droppedAt: number | null = null
  // Drowsy eyes seen since the head left level.
  let drowsySeen = false

  return {
    update(t, downDeg, drowsyEyes) {
      if (downDeg === null) {
        lastLevelT = null
        droppedAt = null
        drowsySeen = false
        return false
      }
      const level = Math.abs(downDeg) <= pose.levelDeg
      if (!level && drowsyEyes) drowsySeen = true

      if (droppedAt !== null) {
        if (level) {
          const nod = drowsySeen
          droppedAt = null
          lastLevelT = t
          drowsySeen = false
          return nod
        }
        if (t - droppedAt > fatigue.nodRecoverMs) {
          droppedAt = null
          drowsySeen = false
        }
        return false
      }

      if (level) {
        lastLevelT = t
        drowsySeen = false
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
