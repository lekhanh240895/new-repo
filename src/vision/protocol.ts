/** Messages between the main thread and the vision worker. */
import type { FrameResult } from '../core/types.ts'
import type { AnalyzerOptions, Delegate } from './analyzer.ts'

export type ToWorker =
  | { type: 'init'; options: AnalyzerOptions }
  | { type: 'frame'; id: number; t: number; debug: boolean; image: ImageBitmap }
  | { type: 'close' }

export type FromWorker =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'result'; id: number; frame: FrameResult }
  | { type: 'error'; id: number | null; message: string }
