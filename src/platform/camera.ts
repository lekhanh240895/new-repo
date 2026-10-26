/** Front camera access with clear, typed errors (SPEC §12 F19). */

export type CameraErrorKind = 'denied' | 'not-found' | 'in-use' | 'insecure' | 'unsupported' | 'unknown'

export class CameraError extends Error {
  readonly kind: CameraErrorKind
  constructor(kind: CameraErrorKind, message: string) {
    super(message)
    this.name = 'CameraError'
    this.kind = kind
  }
}

export interface CameraHandle {
  readonly stream: MediaStream;
  stop(): void;
}

export interface CameraOptions {
  /** Called once if the camera stops on its own (unplugged, taken by another app, permission revoked). */
  onEnded?: () => void;
}

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied.')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', 'No front camera was found.')
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera is busy or could not start. Close other apps using it.')
    default:
      return new CameraError('unknown', `Camera error: ${message}`)
  }
}

/** Opens the front camera and plays it in `video`. Must be called from a user tap. */
export async function openCamera(video: HTMLVideoElement, opts: CameraOptions = {}): Promise<CameraHandle> {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'The camera needs HTTPS (or localhost).')
  }
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    throw new CameraError('unsupported', 'This browser cannot access the camera.')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    })
  } catch (err) {
    throw toCameraError(err)
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (stopped) return
      stop()
      opts.onEnded?.()
    })
  }

  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  try {
    await video.play()
  } catch (err) {
    stop()
    throw new CameraError('unknown', `Could not play the camera stream: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { stream, stop }
}
