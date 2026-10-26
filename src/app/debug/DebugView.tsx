import { useEffect, useRef, useState, type RefObject } from 'react'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import { startSpeedMonitor } from '../../platform/speed.ts'
import { useLang } from '../i18n.ts'
import { LiveChart, type Series } from './LiveChart.tsx'
import { useVisionPipeline, type Sample } from './useVisionPipeline.ts'

const BLUE = '#4ea8de'
const ORANGE = '#f4a261'
const PURPLE = '#b59cff'

const avg = (a: number, b: number) => (a + b) / 2

const EYE_SERIES: Series[] = [
  { label: 'EAR left', color: BLUE, get: (s) => s.smooth.eye?.earL },
  { label: 'EAR right', color: ORANGE, get: (s) => s.smooth.eye?.earR },
]
const BLINK_SERIES: Series[] = [
  { label: 'blink L', color: BLUE, get: (s) => s.smooth.eye?.blinkL },
  { label: 'blink R', color: ORANGE, get: (s) => s.smooth.eye?.blinkR },
]
const MOUTH_SERIES: Series[] = [
  { label: 'MAR', color: BLUE, get: (s) => s.smooth.mouth?.mar },
  { label: 'jawOpen', color: ORANGE, get: (s) => s.smooth.mouth?.jawOpen },
]
const POSE_SERIES: Series[] = [
  { label: 'pitch', color: BLUE, get: (s) => s.smooth.pose?.pitchDeg },
  { label: 'yaw', color: ORANGE, get: (s) => s.smooth.pose?.yawDeg },
  { label: 'roll', color: PURPLE, get: (s) => s.smooth.pose?.rollDeg },
]
const GAZE_SERIES: Series[] = [
  { label: 'gaze x', color: BLUE, get: (s) => s.smooth.gaze?.x },
  { label: 'gaze y', color: ORANGE, get: (s) => s.smooth.gaze?.y },
]
const PERF_SERIES: Series[] = [
  { label: 'infer ms', color: BLUE, get: (s) => s.raw.inferMs },
  { label: 'fps', color: ORANGE, get: (s) => s.fps },
]
const ZERO_GUIDE = [0]
const POSE_GUIDES = [-20, 0, 20]

function fmt(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits)
}

/** Draws the debug landmarks over the (mirrored) video. */
function useOverlay(samplesRef: RefObject<Sample[]>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    const draw = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.clearRect(0, 0, w, h)
      const last = samplesRef.current?.at(-1)
      const pts = last?.raw.debugPoints
      if (pts) {
        ctx.fillStyle = '#2fbf71'
        for (let i = 0; i + 1 < pts.length; i += 2) {
          ctx.beginPath()
          ctx.arc((pts[i] ?? 0) * w, (pts[i + 1] ?? 0) * h, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [samplesRef])
  return canvasRef
}

/**
 * Developer view: camera preview, landmarks and live signal charts (SPEC §16 item 8).
 * For a parked car or a desk only — it is deliberately busy.
 */
export function DebugView() {
  const { videoRef, samplesRef, status, backend, error, start, stop } = useVisionPipeline(true)
  const overlayRef = useOverlay(samplesRef)
  const [latest, setLatest] = useState<Sample | undefined>(undefined)
  const [stoppedMoving, setStoppedMoving] = useState(false)
  const { t } = useLang()

  // Readouts refresh 4× per second; charts redraw every frame on their own.
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => setLatest(samplesRef.current.at(-1)), 250)
    return () => clearInterval(id)
  }, [status, samplesRef])

  // Debug mode is for a parked car: switch off when the car moves (SPEC §16).
  // Uses location only if permission was already given; never prompts here.
  useEffect(() => {
    if (status !== 'running' || navigator.permissions === undefined) return
    let monitor: ReturnType<typeof startSpeedMonitor> | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (cancelled || p.state !== 'granted') return
        monitor = startSpeedMonitor(DEFAULT_CONFIG.speed.debugOffAboveKmh)
        timer = setInterval(() => {
          const kmh = monitor?.speedKmh() ?? null
          if (kmh !== null && kmh > DEFAULT_CONFIG.speed.debugOffAboveKmh) {
            stop()
            setStoppedMoving(true)
          }
        }, 1000)
      })
      .catch(() => {
        // Permission API unavailable: rely on the banner.
      })
    return () => {
      cancelled = true
      if (timer !== null) clearInterval(timer)
      monitor?.stop()
    }
  }, [status, stop])

  return (
    <section className="debug">
      <p className="banner">{t('debug.banner')}</p>
      {stoppedMoving && <p className="error" role="alert">{t('debug.moving')}</p>}

      <div className="row">
        <button type="button" onClick={() => void start()} disabled={status === 'starting' || status === 'running'}>
          Start camera
        </button>
        <button type="button" onClick={stop} disabled={status !== 'running'}>
          Stop
        </button>
        <span className="muted">
          {status}
          {backend !== null && ` · ${backend}`}
        </span>
      </div>
      {error !== null && <p className="error" role="alert">{error}</p>}

      <div className="preview">
        <video ref={videoRef} muted playsInline />
        <canvas ref={overlayRef} />
      </div>

      <dl className="readouts">
        <div><dt>sensor</dt><dd>{latest?.sensor ?? '–'}{latest && !latest.frameValid ? ' (invalid)' : ''}</dd></div>
        <div><dt>fps</dt><dd>{fmt(latest?.fps, 1)}</dd></div>
        <div><dt>infer ms</dt><dd>{fmt(latest?.raw.inferMs, 1)}</dd></div>
        <div><dt>face luma</dt><dd>{fmt(latest?.raw.quality.faceLuma, 0)}</dd></div>
        <div><dt>face area</dt><dd>{fmt(latest?.raw.quality.faceAreaRatio, 3)}</dd></div>
        <div><dt>jitter</dt><dd>{fmt(latest?.raw.quality.landmarkJitter, 4)}</dd></div>
        <div><dt>EAR L / R</dt><dd>{fmt(latest?.smooth.eye?.earL)} / {fmt(latest?.smooth.eye?.earR)}</dd></div>
        <div><dt>blink</dt><dd>{fmt(latest?.smooth.eye && avg(latest.smooth.eye.blinkL, latest.smooth.eye.blinkR))}</dd></div>
        <div><dt>pitch / yaw / roll</dt><dd>{fmt(latest?.smooth.pose?.pitchDeg, 0)} / {fmt(latest?.smooth.pose?.yawDeg, 0)} / {fmt(latest?.smooth.pose?.rollDeg, 0)}</dd></div>
      </dl>

      <div className="charts">
        <LiveChart title="Eye aspect ratio" samplesRef={samplesRef} series={EYE_SERIES} min={0} max={0.5} />
        <LiveChart title="Blink (blendshape)" samplesRef={samplesRef} series={BLINK_SERIES} min={0} max={1} />
        <LiveChart title="Mouth" samplesRef={samplesRef} series={MOUTH_SERIES} min={0} max={1} />
        <LiveChart title="Head pose (°)" samplesRef={samplesRef} series={POSE_SERIES} min={-60} max={60} guides={POSE_GUIDES} />
        <LiveChart title="Gaze" samplesRef={samplesRef} series={GAZE_SERIES} min={-1} max={1} guides={ZERO_GUIDE} />
        <LiveChart title="Performance" samplesRef={samplesRef} series={PERF_SERIES} min={0} max={60} />
      </div>
    </section>
  )
}
