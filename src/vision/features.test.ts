import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  blendshapeScore,
  eyeAspectRatio,
  eyeGaze,
  faceBox,
  LEFT_EYE,
  meanLuma,
  MOUTH,
  mouthAspectRatio,
  pickDriverIndex,
  poseFromMatrix,
  RIGHT_EYE,
  type EyeIndices,
  type Point,
} from './features.ts'

function blankFace(): Point[] {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
}

/** Place a simple eye: corners 0.1 apart, lids `open` above/below the middle. */
function placeEye(lm: Point[], eye: EyeIndices, cx: number, open: number, irisDy = 0) {
  const y = 0.5
  lm[eye.p1] = { x: cx - 0.05, y }
  lm[eye.p4] = { x: cx + 0.05, y }
  lm[eye.p2] = { x: cx - 0.02, y: y - open }
  lm[eye.p3] = { x: cx + 0.02, y: y - open }
  lm[eye.p6] = { x: cx - 0.02, y: y + open }
  lm[eye.p5] = { x: cx + 0.02, y: y + open }
  lm[eye.iris] = { x: cx, y: y + irisDy }
}

const ids = (c: { start: number; end: number }[]) => new Set(c.flatMap((x) => [x.start, x.end]))

describe('landmark indices match MediaPipe naming', () => {
  it('LEFT_EYE uses MediaPipe left-eye points (subject left)', () => {
    const left = ids(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE)
    for (const k of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const) expect(left.has(LEFT_EYE[k])).toBe(true)
  })

  it('RIGHT_EYE uses MediaPipe right-eye points (subject right)', () => {
    const right = ids(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE)
    for (const k of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const) expect(right.has(RIGHT_EYE[k])).toBe(true)
  })

  it('iris centers sit next to the matching iris rings', () => {
    expect(Math.min(...ids(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS))).toBe(LEFT_EYE.iris + 1)
    expect(Math.min(...ids(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS))).toBe(RIGHT_EYE.iris + 1)
  })

  it('mouth points are on the lips', () => {
    const lips = ids(FaceLandmarker.FACE_LANDMARKS_LIPS)
    for (const i of Object.values(MOUTH)) expect(lips.has(i)).toBe(true)
  })
})

describe('eyeAspectRatio', () => {
  it('is (v1 + v2) / 2w for an open eye', () => {
    const lm = blankFace()
    placeEye(lm, LEFT_EYE, 0.6, 0.02)
    expect(eyeAspectRatio(lm, LEFT_EYE, 1)).toBeCloseTo(0.4, 6)
  })

  it('is 0 for a closed eye', () => {
    const lm = blankFace()
    placeEye(lm, RIGHT_EYE, 0.4, 0)
    expect(eyeAspectRatio(lm, RIGHT_EYE, 1)).toBeCloseTo(0, 6)
  })

  it('accounts for non-square frames', () => {
    const lm = blankFace()
    placeEye(lm, LEFT_EYE, 0.6, 0.02)
    // 4:3 frame: horizontal distances are 4/3 longer in pixels.
    expect(eyeAspectRatio(lm, LEFT_EYE, 4 / 3)).toBeCloseTo(0.4 * 0.75, 6)
  })

  it('throws a clear error when landmarks are missing', () => {
    expect(() => eyeAspectRatio([], LEFT_EYE, 1)).toThrow(RangeError)
  })
})

describe('mouthAspectRatio', () => {
  it('is lip gap / mouth width', () => {
    const lm = blankFace()
    lm[MOUTH.left] = { x: 0.55, y: 0.7 }
    lm[MOUTH.right] = { x: 0.45, y: 0.7 }
    lm[MOUTH.top] = { x: 0.5, y: 0.68 }
    lm[MOUTH.bottom] = { x: 0.5, y: 0.74 }
    expect(mouthAspectRatio(lm, 1)).toBeCloseTo(0.6, 6)
  })
})

describe('eyeGaze', () => {
  it('is centered when the iris is in the middle', () => {
    const lm = blankFace()
    placeEye(lm, LEFT_EYE, 0.6, 0.02)
    const g = eyeGaze(lm, LEFT_EYE, 1)
    expect(g.x).toBeCloseTo(0, 6)
    expect(g.y).toBeCloseTo(0, 6)
  })

  it('is negative y when looking down, and clamped', () => {
    const lm = blankFace()
    placeEye(lm, LEFT_EYE, 0.6, 0.02, 0.01)
    expect(eyeGaze(lm, LEFT_EYE, 1).y).toBeCloseTo(-0.5, 6)
    placeEye(lm, LEFT_EYE, 0.6, 0.02, 0.5)
    expect(eyeGaze(lm, LEFT_EYE, 1).y).toBe(-1)
  })
})

describe('poseFromMatrix', () => {
  const rad = (d: number) => (d * Math.PI) / 180
  /** Column-major 4×4 from a row-major 3×3 rotation. */
  const colMajor = (r: number[][]) => {
    const out = new Array<number>(16).fill(0)
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out[col * 4 + row] = r[row]?.[col] ?? 0
    out[15] = 1
    return out
  }
  const rotX = (a: number) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
  const rotY = (a: number) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]
  const rotZ = (a: number) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]

  it('returns zeros for identity', () => {
    const p = poseFromMatrix(colMajor(rotX(0)))
    expect(p?.pitchDeg).toBeCloseTo(0)
    expect(p?.yawDeg).toBeCloseTo(0)
    expect(p?.rollDeg).toBeCloseTo(0)
  })

  it('reads single-axis rotations', () => {
    expect(poseFromMatrix(colMajor(rotX(rad(20))))?.pitchDeg).toBeCloseTo(20)
    expect(poseFromMatrix(colMajor(rotY(rad(25))))?.yawDeg).toBeCloseTo(25)
    expect(poseFromMatrix(colMajor(rotZ(rad(-30))))?.rollDeg).toBeCloseTo(-30)
  })

  it('rejects bad input', () => {
    expect(poseFromMatrix([1, 2, 3])).toBeNull()
    expect(poseFromMatrix(new Array<number>(16).fill(Number.NaN))).toBeNull()
  })
})

describe('pickDriverIndex (SPEC §12 F17: passenger in view)', () => {
  const driver = { x: 0.35, y: 0.2, w: 0.3, h: 0.4 } // center (0.5, 0.4)
  const passenger = { x: 0.7, y: 0.1, w: 0.35, h: 0.45 } // larger, off to the side

  it('without calibration, picks the largest face', () => {
    expect(pickDriverIndex([driver, passenger], null)).toBe(1)
  })

  it('after calibration, picks the face nearest the calibrated position, even if smaller', () => {
    expect(pickDriverIndex([driver, passenger], { x: 0.5, y: 0.4 })).toBe(0)
    expect(pickDriverIndex([passenger, driver], { x: 0.5, y: 0.4 })).toBe(1)
  })

  it('returns -1 with no faces', () => {
    expect(pickDriverIndex([], null)).toBe(-1)
  })
})

describe('small helpers', () => {
  it('meanLuma', () => {
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(127.5)
    expect(meanLuma(new Uint8ClampedArray(0))).toBe(0)
  })

  it('faceBox clamps to the image', () => {
    expect(faceBox([{ x: -0.1, y: 0.2 }, { x: 0.5, y: 1.2 }])).toEqual({ x: 0, y: 0.2, w: 0.5, h: 0.8 })
  })

  it('blendshapeScore finds by name', () => {
    const cats = [{ categoryName: 'eyeBlinkLeft', score: 0.8 }]
    expect(blendshapeScore(cats, 'eyeBlinkLeft')).toBe(0.8)
    expect(blendshapeScore(cats, 'jawOpen')).toBeNull()
  })
})
