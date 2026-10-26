/**
 * Main-thread handle to the vision pipeline. Tries the worker first and
 * falls back to running the model on the main thread (SPEC §6.1).
 */
import type { FrameResult } from '../core/types.ts'
import { createFaceAnalyzer, type AnalyzerOptions, type Delegate } from './analyzer.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export type Backend = `${'worker' | 'main'}-${Lowercase<Delegate>}`

export interface VisionEngine {
  readonly backend: Backend;
  /** Takes ownership of `image` (it is closed or transferred). */
  process(image: ImageBitmap, t: number, debug: boolean): Promise<FrameResult>;
  dispose(): void;
}

export interface EngineOptions {
  preferWorker?: boolean;
  preferGpu?: boolean;
  initTimeoutMs?: number;
  /** Called if the worker dies after start-up. The caller should raise a FAULT. */
  onFatal?: (error: Error) => void;
}

/** Absolute URLs of the self-hosted assets (fetched by scripts/fetch-assets.mjs). */
export function assetUrls(): Pick<AnalyzerOptions, 'wasmBase' | 'modelUrl'> {
  const base = new URL(import.meta.env.BASE_URL, window.location.href)
  return {
    wasmBase: new URL('mediapipe/wasm', base).href,
    modelUrl: new URL('models/face_landmarker.task', base).href,
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

async function startWorker(options: AnalyzerOptions, timeoutMs: number, onFatal: (e: Error) => void): Promise<VisionEngine> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'vision' })
  const pending = new Map<number, { resolve: (f: FrameResult) => void; reject: (e: Error) => void }>()
  let nextId = 1
  let dead = false

  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  let onReady: ((d: Delegate) => void) | null = null
  let onInitError: ((e: Error) => void) | null = null
  const ready = new Promise<Delegate>((resolve, reject) => {
    onReady = resolve
    onInitError = reject
  })

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'ready') onReady?.(msg.delegate)
    else if (msg.type === 'result') {
      pending.get(msg.id)?.resolve(msg.frame)
      pending.delete(msg.id)
    } else if (msg.id === null) {
      onInitError?.(new Error(msg.message))
    } else {
      pending.get(msg.id)?.reject(new Error(msg.message))
      pending.delete(msg.id)
    }
  }
  worker.onerror = (e) => {
    const error = new Error(`vision worker crashed: ${e.message || 'unknown error'}`)
    dead = true
    onInitError?.(error)
    failAll(error)
    onFatal(error)
  }

  const post = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer)
  post({ type: 'init', options: { ...options, useModuleLoader: true } })

  let delegate: Delegate
  try {
    delegate = await withTimeout(ready, timeoutMs, 'vision worker start')
  } catch (err) {
    worker.terminate()
    throw err
  }
  // Errors after start-up are runtime faults, not init failures.
  onInitError = null

  return {
    backend: delegate === 'GPU' ? 'worker-gpu' : 'worker-cpu',
    process(image, t, debug) {
      if (dead) {
        image.close()
        return Promise.reject(new Error('vision worker is not running'))
      }
      const id = nextId++
      return new Promise<FrameResult>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        post({ type: 'frame', id, t, debug, image }, [image])
      })
    },
    dispose() {
      dead = true
      failAll(new Error('vision engine disposed'))
      post({ type: 'close' })
      // Give the worker a moment to free the model, then make sure it is gone.
      setTimeout(() => worker.terminate(), 500)
    },
  }
}

async function startMainThread(options: AnalyzerOptions): Promise<VisionEngine> {
  const analyzer = await createFaceAnalyzer({ ...options, useModuleLoader: false })
  return {
    backend: analyzer.delegate === 'GPU' ? 'main-gpu' : 'main-cpu',
    process(image, t, debug) {
      try {
        return Promise.resolve(analyzer.analyze(image, t, debug))
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)))
      } finally {
        image.close()
      }
    },
    dispose() {
      analyzer.close()
    },
  }
}

export async function startVisionEngine(opts: EngineOptions = {}): Promise<VisionEngine> {
  const options: AnalyzerOptions = {
    ...assetUrls(),
    useModuleLoader: false,
    preferGpu: opts.preferGpu ?? true,
  }
  const onFatal = opts.onFatal ?? (() => {})
  if (opts.preferWorker !== false && typeof Worker !== 'undefined') {
    try {
      return await startWorker(options, opts.initTimeoutMs ?? 20_000, onFatal)
    } catch (err) {
      console.warn('BioMonitor: vision worker failed, running on the main thread', err)
    }
  }
  return startMainThread(options)
}
