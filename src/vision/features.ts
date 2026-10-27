/**
 * Pure geometry on MediaPipe face landmarks (SPEC §8). No DOM, no model.
 * Landmarks are normalized (0–1) to the image. `aspect` = width / height,
 * so distances are measured in real pixels' proportions, not stretched.
 *
 * "Left" and "right" are the SUBJECT's left and right, matching MediaPipe's
 * FACE_LANDMARKS_LEFT_EYE and the eyeBlinkLeft blendshape. Never mirror frames
 * before inference.
 */

export interface Point {
  x: number;
  y: number;
  z?: number;
}

/** Six EAR points: p1/p4 are corners, p2/p6 and p3/p5 are top/bottom pairs. */
export interface EyeIndices {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  iris: number;
}

export const LEFT_EYE: EyeIndices = { p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380, iris: 473 }
export const RIGHT_EYE: EyeIndices = { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 144, iris: 468 }

export const MOUTH = { top: 13, bottom: 14, left: 308, right: 78 } as const

/** Stable point between the eyes, used to measure shake. */
export const NOSE_BRIDGE = 168

/** Landmarks the Debug overlay draws (both eyes, irises, mouth, nose bridge). */
export const DEBUG_LANDMARKS: readonly number[] = [
  ...Object.values(LEFT_EYE),
  ...Object.values(RIGHT_EYE),
  ...Object.values(MOUTH),
  NOSE_BRIDGE,
]

/** Fewer landmarks than this means the model did not return the iris points. */
export const MIN_LANDMARKS = 478

function at(lm: readonly Point[], i: number): Point {
  const p = lm[i]
  if (p === undefined) throw new RangeError(`landmark ${i} missing (got ${lm.length})`)
  return p
}

export function distance(a: Point, b: Point, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

/** EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2‖p1−p4‖). About 0.25–0.35 open, near 0 closed. */
export function eyeAspectRatio(lm: readonly Point[], eye: EyeIndices, aspect: number): number {
  const width = distance(at(lm, eye.p1), at(lm, eye.p4), aspect)
  if (width === 0) return 0
  const v1 = distance(at(lm, eye.p2), at(lm, eye.p6), aspect)
  const v2 = distance(at(lm, eye.p3), at(lm, eye.p5), aspect)
  return (v1 + v2) / (2 * width)
}

/** MAR = inner-lip gap / mouth width. */
export function mouthAspectRatio(lm: readonly Point[], aspect: number): number {
  const width = distance(at(lm, MOUTH.left), at(lm, MOUTH.right), aspect)
  if (width === 0) return 0
  return distance(at(lm, MOUTH.top), at(lm, MOUTH.bottom), aspect) / width
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Coarse iris position inside one eye, each axis −1..1.
 * x: along the corner-to-corner axis. y: positive = looking up, negative = down.
 * Scaled by eye width because eye height collapses when the eye closes.
 */
export function eyeGaze(lm: readonly Point[], eye: EyeIndices, aspect: number): { x: number; y: number } {
  const c1 = at(lm, eye.p1)
  const c4 = at(lm, eye.p4)
  const iris = at(lm, eye.iris)
  const ax = (c4.x - c1.x) * aspect
  const ay = c4.y - c1.y
  const len2 = ax * ax + ay * ay
  if (len2 === 0) return { x: 0, y: 0 }
  const t = (((iris.x - c1.x) * aspect) * ax + (iris.y - c1.y) * ay) / len2
  const midY = (at(lm, eye.p2).y + at(lm, eye.p3).y + at(lm, eye.p5).y + at(lm, eye.p6).y) / 4
  const width = Math.sqrt(len2)
  return {
    x: clamp(t * 2 - 1, -1, 1),
    y: clamp(-(iris.y - midY) / (width * 0.2), -1, 1),
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of all landmarks, clamped to the image. */
export function faceBox(lm: readonly Point[]): Box {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of lm) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  minX = clamp(minX, 0, 1)
  minY = clamp(minY, 0, 1)
  maxX = clamp(maxX, 0, 1)
  maxY = clamp(maxY, 0, 1)
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) }
}

/**
 * Which detected face is the driver (SPEC §12 F17). With a calibrated position,
 * the face whose center is nearest to it; otherwise the largest (closest to the
 * camera). Returns -1 when there are no faces.
 */
export function pickDriverIndex(boxes: readonly Box[], prefer: Point | null): number {
  let best = -1
  let bestScore = Infinity
  for (const [i, b] of boxes.entries()) {
    const score =
      prefer === null
        ? -(b.w * b.h)
        : Math.hypot(b.x + b.w / 2 - prefer.x, b.y + b.h / 2 - prefer.y)
    if (score < bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/** Mean Rec. 601 luma (0–255) of RGBA pixels. */
export function meanLuma(rgba: Uint8ClampedArray): number {
  const n = Math.floor(rgba.length / 4)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n * 4; i += 4) {
    sum += 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0)
  }
  return sum / n
}

export interface Pose {
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
}

const DEG = 180 / Math.PI

/**
 * Head pose from MediaPipe's 4×4 facial transformation matrix
 * (column-major, as in MediaPipe's MatrixData). Returns null for bad input.
 *
 * Sign convention (measured on real clips, P7): pitch > 0 = head down,
 * yaw < 0 = head turned to the subject's right, roll = tilt.
 */
export function poseFromMatrix(data: readonly number[]): Pose | null {
  if (data.length !== 16 || data.some((v) => !Number.isFinite(v))) return null
  // Column-major: element (row r, col c) is data[c * 4 + r].
  const m = (r: number, c: number) => data[c * 4 + r] ?? 0
  const sy = Math.hypot(m(0, 0), m(1, 0))
  const singular = sy < 1e-6
  const pitch = singular ? Math.atan2(-m(1, 2), m(1, 1)) : Math.atan2(m(2, 1), m(2, 2))
  const yaw = Math.atan2(-m(2, 0), sy)
  const roll = singular ? 0 : Math.atan2(m(1, 0), m(0, 0))
  return { pitchDeg: pitch * DEG, yawDeg: yaw * DEG, rollDeg: roll * DEG }
}

/** Score of a named blendshape (for example "eyeBlinkLeft"), or null if missing. */
export function blendshapeScore(
  categories: readonly { categoryName: string; score: number }[],
  name: string,
): number | null {
  const c = categories.find((x) => x.categoryName === name)
  return c === undefined ? null : c.score
}
