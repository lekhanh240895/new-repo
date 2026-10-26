/**
 * Builders for synthetic ProcessedFrames, for calibration and detector tests.
 * Defaults describe an alert driver looking at the road.
 */
import type { ProcessedFrame, SensorState } from '../core/types.ts'

export interface FrameSpec {
  ear?: number;
  blink?: number;
  /** Per-eye overrides, for head-turn tests. */
  earL?: number;
  earR?: number;
  widthL?: number;
  widthR?: number;
  mar?: number;
  jaw?: number;
  pitch?: number;
  yaw?: number;
  gazeY?: number;
  faceFound?: boolean;
  sensor?: SensorState;
  valid?: boolean;
  jitter?: number;
  center?: { x: number; y: number };
}

export const OPEN_EAR = 0.3

export function processed(t: number, spec: FrameSpec = {}): ProcessedFrame {
  const faceFound = spec.faceFound ?? true
  const ear = spec.ear ?? OPEN_EAR
  const blink = spec.blink ?? 0.05
  const raw = faceFound
    ? {
        t,
        inferMs: 20,
        faceFound: true,
        quality: {
          faceLuma: 120,
          faceAreaRatio: 0.15,
          landmarkJitter: spec.jitter ?? 0.004,
          faceCenter: spec.center ?? { x: 0.5, y: 0.45 },
        },
        eye: {
          earL: spec.earL ?? ear,
          earR: spec.earR ?? ear,
          blinkL: blink,
          blinkR: blink,
          widthL: spec.widthL ?? 0.08,
          widthR: spec.widthR ?? 0.08,
        },
        mouth: { mar: spec.mar ?? 0.05, jawOpen: spec.jaw ?? 0.02 },
        pose: { pitchDeg: spec.pitch ?? 0, yawDeg: spec.yaw ?? 0, rollDeg: 0 },
        gaze: { x: 0, y: spec.gazeY ?? 0 },
      }
    : { t, inferMs: 20, faceFound: false, quality: { faceLuma: 120, faceAreaRatio: 0, landmarkJitter: 0 } }
  return {
    raw,
    smooth: raw,
    sensor: spec.sensor ?? (faceFound ? 'OK' : 'NO_FACE'),
    frameValid: spec.valid ?? faceFound,
    fps: 15,
  }
}

export interface FrameSegment {
  ms: number;
  spec?: FrameSpec;
}

/** Expand segments into frames at 15 fps with whole-ms timestamps. */
export function framesFrom(segments: readonly FrameSegment[], t0 = 0): ProcessedFrame[] {
  const out: ProcessedFrame[] = []
  let i = 0
  for (const seg of segments) {
    const n = Math.round(seg.ms / (1000 / 15))
    for (let k = 0; k < n; k++) out.push(processed(t0 + Math.round((i++ * 1000) / 15), seg.spec))
  }
  return out
}
