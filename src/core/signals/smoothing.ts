/**
 * Applies the One Euro filter to the derived signals, not to the raw
 * landmarks (SPEC §8.5): cheaper, and blinks stay sharp.
 */
import { createOneEuroFilter, type OneEuroParams } from '../filters/oneEuro.ts'
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

export type ChannelGroup = 'ratio' | 'angle' | 'gaze'

/**
 * `beta` depends on the signal's units. The textbook 0.007 is for pixel
 * coordinates; on 0–1 ratios it barely reacts to speed and delays a blink by
 * ~200 ms. These values follow a 0.3 → 0.05 EAR drop within about one frame
 * while still smoothing small jitter (tested in smoothing.test.ts).
 */
export const SMOOTHING: Readonly<Record<ChannelGroup, OneEuroParams>> = Object.freeze({
  ratio: { minCutoff: 1.5, beta: 4, dCutoff: 1 },
  angle: { minCutoff: 1, beta: 0.05, dCutoff: 1 },
  gaze: { minCutoff: 1, beta: 1, dCutoff: 1 },
})

const GROUP: Record<Channel, ChannelGroup> = {
  earL: 'ratio',
  earR: 'ratio',
  blinkL: 'ratio',
  blinkR: 'ratio',
  mar: 'ratio',
  jawOpen: 'ratio',
  pitchDeg: 'angle',
  yawDeg: 'angle',
  rollDeg: 'angle',
  gazeX: 'gaze',
  gazeY: 'gaze',
}

export interface SignalSmoother {
  /** Returns a copy of `frame` with smoothed signals. Resets when the face is lost. */
  smooth(frame: FrameResult): FrameResult;
  reset(): void;
}

export function createSignalSmoother(params: Readonly<Record<ChannelGroup, OneEuroParams>> = SMOOTHING): SignalSmoother {
  const filters = Object.fromEntries(
    CHANNELS.map((c) => [c, createOneEuroFilter(params[GROUP[c]])]),
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
            ...eye,
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
