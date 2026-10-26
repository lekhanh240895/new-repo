/**
 * Wraps MediaPipe Face Landmarker and turns its output into a FrameResult
 * (numbers only). Runs in the vision worker, or on the main thread as a
 * fallback (SPEC §6.1).
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import type { FrameResult } from '../core/types.ts'
import {
  blendshapeScore,
  DEBUG_LANDMARKS,
  distance,
  eyeAspectRatio,
  eyeGaze,
  faceBox,
  LEFT_EYE,
  meanLuma,
  MIN_LANDMARKS,
  mouthAspectRatio,
  pickDriverIndex,
  NOSE_BRIDGE,
  poseFromMatrix,
  RIGHT_EYE,
  type Box,
  type Point,
} from './features.ts'

export type Delegate = 'GPU' | 'CPU'

export interface AnalyzerOptions {
  /** Absolute URL of the folder holding the MediaPipe wasm files. */
  wasmBase: string;
  /** Absolute URL of face_landmarker.task. */
  modelUrl: string;
  /** True inside a module worker (loads the ES-module wasm loader). */
  useModuleLoader: boolean;
  preferGpu: boolean;
}

export interface FaceAnalyzer {
  readonly delegate: Delegate;
  /** `prefer`: calibrated face center, used to pick the driver when 2 faces are seen. */
  analyze(image: ImageBitmap, t: number, debug: boolean, prefer?: Point | null): FrameResult;
  close(): void;
}

const LUMA_SIZE = 32

async function createLandmarker(opts: AnalyzerOptions, delegate: Delegate): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase, opts.useModuleLoader)
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: opts.modelUrl, delegate },
    runningMode: 'VIDEO',
    // Two faces so a passenger does not replace the driver (SPEC §12 F17).
    numFaces: 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  })
}

/** The driver's face: nearest to the calibrated position, else the largest. */
function pickDriver(result: FaceLandmarkerResult, prefer: Point | null): { index: number; box: Box } | null {
  const usable = [...result.faceLandmarks.entries()].filter(([, lm]) => lm.length >= MIN_LANDMARKS)
  const boxes = usable.map(([, lm]) => faceBox(lm))
  const i = pickDriverIndex(boxes, prefer)
  const entry = usable[i]
  const box = boxes[i]
  return entry === undefined || box === undefined ? null : { index: entry[0], box }
}

export async function createFaceAnalyzer(opts: AnalyzerOptions): Promise<FaceAnalyzer> {
  let landmarker: FaceLandmarker
  let delegate: Delegate = opts.preferGpu ? 'GPU' : 'CPU'
  try {
    landmarker = await createLandmarker(opts, delegate)
  } catch (gpuError) {
    if (delegate === 'CPU') throw gpuError
    console.warn('BioMonitor: GPU delegate failed, using CPU', gpuError)
    delegate = 'CPU'
    landmarker = await createLandmarker(opts, delegate)
  }

  const lumaCanvas = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(LUMA_SIZE, LUMA_SIZE)
  const lumaCtx = lumaCanvas?.getContext('2d', { willReadFrequently: true }) ?? null
  let lastTs = -1
  let prevBridge: Point | null = null

  /** Mean luma of a region (normalized box). NaN if 2D canvas is unavailable. */
  function lumaOf(image: ImageBitmap, box: Box): number {
    if (lumaCtx === null) return Number.NaN
    const sw = Math.max(1, box.w * image.width)
    const sh = Math.max(1, box.h * image.height)
    lumaCtx.drawImage(image, box.x * image.width, box.y * image.height, sw, sh, 0, 0, LUMA_SIZE, LUMA_SIZE)
    return meanLuma(lumaCtx.getImageData(0, 0, LUMA_SIZE, LUMA_SIZE).data)
  }

  return {
    delegate,
    analyze(image, t, debug, prefer = null) {
      // MediaPipe needs strictly increasing timestamps in VIDEO mode.
      const ts = Math.max(lastTs + 1, Math.round(t))
      lastTs = ts
      const start = performance.now()
      const result = landmarker.detectForVideo(image, ts)
      const inferMs = performance.now() - start
      const aspect = image.width / image.height

      const driver = pickDriver(result, prefer)
      const lm = driver === null ? undefined : result.faceLandmarks[driver.index]
      if (driver === null || lm === undefined) {
        prevBridge = null
        return {
          t,
          inferMs,
          faceFound: false,
          // Whole-frame light, so "too dark" can be told apart from "no driver".
          quality: { faceLuma: lumaOf(image, { x: 0, y: 0, w: 1, h: 1 }), faceAreaRatio: 0, landmarkJitter: 0 },
        }
      }

      const bridge = lm[NOSE_BRIDGE] ?? { x: 0, y: 0 }
      const eyeSpan = distance(lm[LEFT_EYE.p4] ?? bridge, lm[RIGHT_EYE.p1] ?? bridge, aspect) || 1
      const landmarkJitter = prevBridge === null ? 0 : distance(bridge, prevBridge, aspect) / eyeSpan
      prevBridge = { x: bridge.x, y: bridge.y }

      const cats = result.faceBlendshapes[driver.index]?.categories ?? []
      const matrix = result.facialTransformationMatrixes[driver.index]
      const pose = matrix === undefined ? null : poseFromMatrix(matrix.data)
      const gL = eyeGaze(lm, LEFT_EYE, aspect)
      const gR = eyeGaze(lm, RIGHT_EYE, aspect)

      const frame: FrameResult = {
        t,
        inferMs,
        faceFound: true,
        quality: {
          faceLuma: lumaOf(image, driver.box),
          faceAreaRatio: driver.box.w * driver.box.h,
          landmarkJitter,
          faceCenter: { x: driver.box.x + driver.box.w / 2, y: driver.box.y + driver.box.h / 2 },
        },
        eye: {
          earL: eyeAspectRatio(lm, LEFT_EYE, aspect),
          earR: eyeAspectRatio(lm, RIGHT_EYE, aspect),
          blinkL: blendshapeScore(cats, 'eyeBlinkLeft') ?? 0,
          blinkR: blendshapeScore(cats, 'eyeBlinkRight') ?? 0,
          widthL: distance(lm[LEFT_EYE.p1] ?? bridge, lm[LEFT_EYE.p4] ?? bridge, aspect),
          widthR: distance(lm[RIGHT_EYE.p1] ?? bridge, lm[RIGHT_EYE.p4] ?? bridge, aspect),
        },
        mouth: { mar: mouthAspectRatio(lm, aspect), jawOpen: blendshapeScore(cats, 'jawOpen') ?? 0 },
        gaze: { x: (gL.x + gR.x) / 2, y: (gL.y + gR.y) / 2 },
        ...(pose !== null && { pose }),
      }
      if (debug) {
        frame.debugPoints = DEBUG_LANDMARKS.flatMap((i) => {
          const p = lm[i]
          return p === undefined ? [] : [p.x, p.y]
        })
      }
      return frame
    },
    close() {
      landmarker.close()
    },
  }
}
