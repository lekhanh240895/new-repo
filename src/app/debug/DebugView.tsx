import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
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
const GREEN = '#2fbf71'
const PINK = '#ff7eb6'
/** Iris and blendshape eye direction should move together; if not, check the sign conventions. */
const GAZE_SERIES: Series[] = [
  { label: 'iris x', color: BLUE, get: (s) => s.smooth.gaze?.x },
  { label: 'iris y', color: ORANGE, get: (s) => s.smooth.gaze?.y },
  { label: 'blend x', color: GREEN, get: (s) => s.smooth.eye?.lookX },
  { label: 'blend y', color: PINK, get: (s) => s.smooth.eye?.lookY },
]
const PERF_SERIES: Series[] = [
  { label: 'infer ms', color: BLUE, get: (s) => s.raw.inferMs },
  { label: 'fps', color: ORANGE, get: (s) => s.fps },
]
const ZERO_GUIDE = [0]
const POSE_GUIDES = [-20, 0, 20]

type Lang = 'vi' | 'en'
type Entry = readonly [label: string, hint: string]

/** Each readout and chart: a plain name and what it means / what to expect. */
const WORDS: Record<Lang, Record<string, Entry>> = {
  vi: {
    sensor: ['Trạng thái cảm biến', 'OK = thấy mặt rõ. Khác OK = mặt mất, quá tối, quá sáng hoặc rung'],
    fps: ['Khung hình/giây', 'Từ 10 trở lên là ổn; thấp hơn thì app xử lý chậm'],
    infer: ['Thời gian nhận diện (ms)', 'Mỗi khung mất bao lâu; dưới 60 là tốt'],
    luma: ['Độ sáng mặt', 'Khoảng 60–200 là đủ sáng; dưới 40 quá tối'],
    area: ['Kích thước mặt', 'Phần khung hình mặt chiếm; khoảng 0.1–0.4 là tốt'],
    jitter: ['Độ rung', 'Càng nhỏ càng ổn định; số lớn = điện thoại rung'],
    ear: ['Độ mở mắt trái / phải (EAR)', 'Mở ~0.25–0.35; nhắm ~0.1 trở xuống'],
    blink: ['Chớp mắt', '0 = mở, 1 = nhắm hẳn'],
    pose: ['Góc đầu: gật / quay / nghiêng (độ)', 'Gật: dương = cúi xuống. Quay: âm = quay phải, dương = quay trái (so với lúc calibrate)'],
    cEye: ['Độ mở mắt (EAR)', 'Hai đường tụt xuống gần 0 khi nhắm mắt'],
    cBlink: ['Chớp mắt (blendshape)', 'Hai đường vọt lên gần 1 khi nhắm mắt'],
    cMouth: ['Miệng', 'Lên cao khi há miệng (ngáp, nói chuyện)'],
    cPose: ['Góc đầu (độ)', 'pitch = gật (dương là cúi) · yaw = quay trái/phải · roll = nghiêng đầu'],
    cGaze: ['Hướng nhìn của mắt', 'iris và blend nên đi cùng chiều; lệch nhau thì mắt đang không ổn'],
    cPerf: ['Hiệu năng', 'infer ms = thời gian nhận diện; fps = khung hình mỗi giây'],
  },
  en: {
    sensor: ['Sensor state', 'OK = face clearly seen. Anything else = face lost, too dark, glare or shake'],
    fps: ['Frames per second', '10 or more is fine; lower means the app is slow'],
    infer: ['Detection time (ms)', 'How long one frame takes; under 60 is good'],
    luma: ['Face brightness', 'About 60–200 is bright enough; under 40 is too dark'],
    area: ['Face size', 'Share of the picture the face fills; about 0.1–0.4 is good'],
    jitter: ['Shake', 'Smaller is steadier; a big number means the phone shakes'],
    ear: ['Eye openness left / right (EAR)', 'Open ~0.25–0.35; closed ~0.1 or less'],
    blink: ['Blink', '0 = open, 1 = fully closed'],
    pose: ['Head angle: nod / turn / tilt (°)', 'Nod: positive = looking down. Turn: negative = right, positive = left (from calibration)'],
    cEye: ['Eye openness (EAR)', 'Both lines drop near 0 when the eyes close'],
    cBlink: ['Blink (blendshape)', 'Both lines jump near 1 when the eyes close'],
    cMouth: ['Mouth', 'Rises when the mouth opens (yawn, talking)'],
    cPose: ['Head angle (°)', 'pitch = nod (positive is down) · yaw = turn left/right · roll = head tilt'],
    cGaze: ['Eye direction', 'iris and blend should move together; if not, the eyes are unreliable'],
    cPerf: ['Performance', 'infer ms = detection time; fps = frames per second'],
  },
}

function fmt(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits)
}

function Readout({ entry, children }: { entry: Entry; children: ReactNode }) {
  return (
    <div>
      <dt>{entry[0]}<small className="muted">{entry[1]}</small></dt>
      <dd>{children}</dd>
    </div>
  )
}

function Chart({ entry, children }: { entry: Entry; children: ReactNode }) {
  return (
    <div className="chart-box">
      {children}
      <p className="muted small">{entry[1]}</p>
    </div>
  )
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
export function DebugView({ onBehaviorTest }: { onBehaviorTest?: () => void }) {
  const { videoRef, samplesRef, status, backend, error, start, stop } = useVisionPipeline(true)
  const overlayRef = useOverlay(samplesRef)
  const [latest, setLatest] = useState<Sample | undefined>(undefined)
  const [stoppedMoving, setStoppedMoving] = useState(false)
  const { t, lang } = useLang()
  const w = WORDS[lang]
  const word = (k: string): Entry => w[k] ?? [k, '']

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
      {onBehaviorTest !== undefined && (
        <p>
          <button type="button" className="primary" onClick={onBehaviorTest}>
            {lang === 'vi' ? 'Kiểm tra hành vi và nghe cảnh báo (có chấm đúng/sai)' : 'Test behaviors and hear alerts (with pass/fail)'}
          </button>
        </p>
      )}
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
        <Readout entry={word('sensor')}>{latest?.sensor ?? '–'}{latest && !latest.frameValid ? ' (invalid)' : ''}</Readout>
        <Readout entry={word('fps')}>{fmt(latest?.fps, 1)}</Readout>
        <Readout entry={word('infer')}>{fmt(latest?.raw.inferMs, 1)}</Readout>
        <Readout entry={word('luma')}>{fmt(latest?.raw.quality.faceLuma, 0)}</Readout>
        <Readout entry={word('area')}>{fmt(latest?.raw.quality.faceAreaRatio, 3)}</Readout>
        <Readout entry={word('jitter')}>{fmt(latest?.raw.quality.landmarkJitter, 4)}</Readout>
        <Readout entry={word('ear')}>{fmt(latest?.smooth.eye?.earL)} / {fmt(latest?.smooth.eye?.earR)}</Readout>
        <Readout entry={word('blink')}>{fmt(latest?.smooth.eye && avg(latest.smooth.eye.blinkL, latest.smooth.eye.blinkR))}</Readout>
        <Readout entry={word('pose')}>{fmt(latest?.smooth.pose?.pitchDeg, 0)} / {fmt(latest?.smooth.pose?.yawDeg, 0)} / {fmt(latest?.smooth.pose?.rollDeg, 0)}</Readout>
      </dl>

      <div className="charts">
        <Chart entry={word('cEye')}><LiveChart title={word('cEye')[0]} samplesRef={samplesRef} series={EYE_SERIES} min={0} max={0.5} /></Chart>
        <Chart entry={word('cBlink')}><LiveChart title={word('cBlink')[0]} samplesRef={samplesRef} series={BLINK_SERIES} min={0} max={1} /></Chart>
        <Chart entry={word('cMouth')}><LiveChart title={word('cMouth')[0]} samplesRef={samplesRef} series={MOUTH_SERIES} min={0} max={1} /></Chart>
        <Chart entry={word('cPose')}><LiveChart title={word('cPose')[0]} samplesRef={samplesRef} series={POSE_SERIES} min={-60} max={60} guides={POSE_GUIDES} /></Chart>
        <Chart entry={word('cGaze')}><LiveChart title={word('cGaze')[0]} samplesRef={samplesRef} series={GAZE_SERIES} min={-1} max={1} guides={ZERO_GUIDE} /></Chart>
        <Chart entry={word('cPerf')}><LiveChart title={word('cPerf')[0]} samplesRef={samplesRef} series={PERF_SERIES} min={0} max={60} /></Chart>
      </div>
    </section>
  )
}
