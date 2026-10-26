/**
 * Grabs downscaled frames from the camera video at a target rate.
 * At most one frame is in flight: if analysis is slow, frames are skipped,
 * never queued (SPEC §12 F6).
 */

export interface FrameLoopOptions {
  video: HTMLVideoElement;
  targetFps: number;
  /** Width of the frame sent to the model. Height keeps the video's aspect ratio. */
  width: number;
  onFrame(image: ImageBitmap, t: number): Promise<void>;
  onError(error: Error): void;
}

export interface FrameLoop {
  stop(): void;
  setTargetFps(fps: number): void;
  setWidth(width: number): void;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export function startFrameLoop(opts: FrameLoopOptions): FrameLoop {
  const video = opts.video as VideoWithFrameCallback
  const useVideoCallback = typeof video.requestVideoFrameCallback === 'function'
  let targetFps = opts.targetFps
  let width = opts.width
  let running = true
  let busy = false
  let lastSent = -Infinity
  let handle = 0
  // Some browsers (older Safari) reject createImageBitmap resize options.
  let resizeSupported = true

  async function grab(): Promise<ImageBitmap> {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (resizeSupported && vw > width) {
      try {
        return await createImageBitmap(video, {
          resizeWidth: width,
          resizeHeight: Math.round((width * vh) / vw),
          resizeQuality: 'low',
        })
      } catch {
        resizeSupported = false
      }
    }
    return createImageBitmap(video)
  }

  function schedule() {
    if (!running) return
    handle = useVideoCallback
      ? (video.requestVideoFrameCallback?.(tick) ?? 0)
      : requestAnimationFrame(tick)
  }

  function tick() {
    if (!running) return
    const now = performance.now()
    const ready = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0
    if (ready && !busy && now - lastSent >= 1000 / targetFps - 2) {
      busy = true
      lastSent = now
      grab()
        .then((image) => (running ? opts.onFrame(image, now) : image.close()))
        .catch((err: unknown) => {
          // After stop(), in-flight frames fail on purpose (engine disposed); not an error.
          if (running) opts.onError(err instanceof Error ? err : new Error(String(err)))
        })
        .finally(() => {
          busy = false
        })
    }
    schedule()
  }

  schedule()

  return {
    stop() {
      running = false
      if (useVideoCallback) video.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
    },
    setTargetFps(fps) {
      targetFps = Math.max(1, fps)
    },
    setWidth(w) {
      width = Math.max(64, Math.round(w))
    },
  }
}
