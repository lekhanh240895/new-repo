import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import { createQualityTracker } from '../../core/signals/quality.ts'
import { createSignalSmoother } from '../../core/signals/smoothing.ts'
import type { ProcessedFrame } from '../../core/types.ts'
import { CameraError, openCamera, type CameraHandle } from '../../platform/camera.ts'
import { startFrameLoop, type FrameLoop } from '../../platform/frameLoop.ts'
import { startVisionEngine, type Backend, type VisionEngine } from '../../vision/engine.ts'

/** One processed frame, as shown in Debug mode. */
export type Sample = ProcessedFrame

export type PipelineStatus = 'idle' | 'starting' | 'running' | 'error'

/** 20 s of history at 15 fps. */
const HISTORY = 300
const TARGET_FPS = 15
const FRAME_WIDTH = 480

declare global {
  interface Window {
    /** Set when the page is opened with ?replay — the replay harness reads it (SPEC §15). */
    __biomonitorReplay?: { backend: Backend | null; samples: Sample[]; errors: string[] };
  }
}

function describe(err: unknown): string {
  if (err instanceof CameraError) return err.message
  return err instanceof Error ? err.message : String(err)
}

export function useVisionPipeline(debug: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const samplesRef = useRef<Sample[]>([])
  const [status, setStatus] = useState<PipelineStatus>('idle')
  const [backend, setBackend] = useState<Backend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const parts = useRef<{ camera: CameraHandle | null; engine: VisionEngine | null; loop: FrameLoop | null }>({
    camera: null,
    engine: null,
    loop: null,
  })

  const params = new URLSearchParams(window.location.search)
  const replay = params.has('replay')
  // Debug switches: ?delegate=cpu forces the CPU model, ?worker=0 forces the main-thread fallback.
  const preferGpu = params.get('delegate') !== 'cpu'
  const preferWorker = params.get('worker') !== '0'

  const stop = useCallback(() => {
    const p = parts.current
    p.loop?.stop()
    p.engine?.dispose()
    p.camera?.stop()
    parts.current = { camera: null, engine: null, loop: null }
    setStatus((s) => (s === 'error' ? s : 'idle'))
  }, [])

  const fail = useCallback(
    (err: unknown) => {
      const message = describe(err)
      console.error('BioMonitor pipeline error:', err)
      window.__biomonitorReplay?.errors.push(message)
      setError(message)
      setStatus('error')
      stop()
    },
    [stop],
  )

  /** Must be called from a tap/click: the camera needs a user gesture on mobile. */
  const start = useCallback(async () => {
    const video = videoRef.current
    if (video === null || parts.current.camera !== null) return
    setError(null)
    setStatus('starting')
    if (replay) window.__biomonitorReplay = { backend: null, samples: [], errors: [] }
    try {
      const camera = await openCamera(video, { onEnded: () => fail(new Error('The camera stopped.')) })
      parts.current.camera = camera
      const engine = await startVisionEngine({ onFatal: fail, preferGpu, preferWorker })
      parts.current.engine = engine
      setBackend(engine.backend)
      if (window.__biomonitorReplay) window.__biomonitorReplay.backend = engine.backend

      const smoother = createSignalSmoother()
      const quality = createQualityTracker(DEFAULT_CONFIG.quality)
      samplesRef.current = []

      parts.current.loop = startFrameLoop({
        video,
        targetFps: TARGET_FPS,
        width: FRAME_WIDTH,
        onError: fail,
        async onFrame(image, t) {
          const raw = await engine.process(image, t, debug)
          const q = quality.update(raw)
          const sample: Sample = { raw, smooth: smoother.smooth(raw), ...q }
          const buf = samplesRef.current
          buf.push(sample)
          if (buf.length > HISTORY) buf.shift()
          window.__biomonitorReplay?.samples.push(sample)
        },
      })
      setStatus('running')
    } catch (err) {
      fail(err)
    }
  }, [debug, fail, replay, preferGpu, preferWorker])

  useEffect(() => stop, [stop])

  return { videoRef, samplesRef, status, backend, error, start, stop }
}
