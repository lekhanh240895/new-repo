/**
 * Vision worker entry. Runs Face Landmarker off the main thread and sends
 * back numbers only. Frames are closed here; they never leave the worker.
 */
import { createFaceAnalyzer, type FaceAnalyzer } from './analyzer.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

// The app's TS config uses DOM types; describe just the worker API we use.
interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  close(): void;
}
const scope = self as unknown as WorkerScope

let analyzer: FaceAnalyzer | null = null

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

scope.onmessage = (e) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      createFaceAnalyzer(msg.options)
        .then((a) => {
          analyzer = a
          scope.postMessage({ type: 'ready', delegate: a.delegate })
        })
        .catch((err: unknown) => scope.postMessage({ type: 'error', id: null, message: errorMessage(err) }))
      return
    case 'frame':
      try {
        if (analyzer === null) throw new Error('frame received before init finished')
        const frame = analyzer.analyze(msg.image, msg.t, msg.debug, msg.prefer)
        scope.postMessage({ type: 'result', id: msg.id, frame })
      } catch (err) {
        scope.postMessage({ type: 'error', id: msg.id, message: errorMessage(err) })
      } finally {
        msg.image.close()
      }
      return
    case 'close':
      analyzer?.close()
      analyzer = null
      scope.close()
      return
  }
}
