/**
 * Applies the One Euro filter to the derived signals, not to the raw
 * landmarks (SPEC §8.5): cheaper, and blinks stay sharp.
 */
import { createOneEuroFilter, DEFAULT_ONE_EURO, type OneEuroParams } from '../filters/oneEuro.ts'
import type { FrameResult } from '../types.ts'

const CHANNELS = [
  'earL',
  'earR',
  'blinkL',
  'blinkR',
  'mar',
  'jawOpen',
  'pitchDeg',
  'yawDeg',
  'rollDeg',
  'gazeX',
  'gazeY',
] as const

type Channel = (typeof CHANNELS)[number]

export interface SignalSmoother {
  /** Returns a copy of `frame` with smoothed signals. Resets when the face is lost. */
  smooth(frame: FrameResult): FrameResult;
  reset(): void;
}

export function createSignalSmoother(params: OneEuroParams = DEFAULT_ONE_EURO): SignalSmoother {
  const filters = Object.fromEntries(
    CHANNELS.map((c) => [c, createOneEuroFilter(params)]),
  ) as Record<Channel, ReturnType<typeof createOneEuroFilter>>

  const reset = () => {
    for (const c of CHANNELS) filters[c].reset()
  }
  const f = (c: Channel, v: number, t: number) => filters[c].filter(v, t)

  return {
    smooth(frame) {
      if (!frame.faceFound) {
        reset()
        return frame
      }
      const { t, eye, mouth, pose, gaze } = frame
      return {
        ...frame,
        ...(eye && {
          eye: {
            earL: f('earL', eye.earL, t),
            earR: f('earR', eye.earR, t),
            blinkL: f('blinkL', eye.blinkL, t),
            blinkR: f('blinkR', eye.blinkR, t),
          },
        }),
        ...(mouth && { mouth: { mar: f('mar', mouth.mar, t), jawOpen: f('jawOpen', mouth.jawOpen, t) } }),
        ...(pose && {
          pose: {
            pitchDeg: f('pitchDeg', pose.pitchDeg, t),
            yawDeg: f('yawDeg', pose.yawDeg, t),
            rollDeg: f('rollDeg', pose.rollDeg, t),
          },
        }),
        ...(gaze && { gaze: { x: f('gazeX', gaze.x, t), y: f('gazeY', gaze.y, t) } }),
      }
    },
    reset,
  }
}
