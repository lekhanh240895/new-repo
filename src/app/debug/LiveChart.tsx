import { useEffect, useRef, type RefObject } from 'react'
import type { Sample } from './useVisionPipeline.ts'

export interface Series {
  label: string;
  color: string;
  get(s: Sample): number | undefined;
}

interface LiveChartProps {
  title: string;
  samplesRef: RefObject<Sample[]>;
  series: readonly Series[];
  min: number;
  max: number;
  /** Optional horizontal guide lines (for example a threshold). */
  guides?: readonly number[];
}

/** A small canvas line chart, redrawn every animation frame from the sample buffer. */
export function LiveChart({ title, samplesRef, series, min, max, guides = [] }: LiveChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const y = (v: number) => h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * h

      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1
      for (const g of guides) {
        ctx.beginPath()
        ctx.moveTo(0, y(g))
        ctx.lineTo(w, y(g))
        ctx.stroke()
      }

      const samples = samplesRef.current ?? []
      const n = samples.length
      if (n > 1) {
        const t0 = samples[0]?.raw.t ?? 0
        const t1 = samples[n - 1]?.raw.t ?? 1
        const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w
        ctx.lineWidth = 1.5
        for (const s of series) {
          ctx.strokeStyle = s.color
          ctx.beginPath()
          let pen = false
          for (const sample of samples) {
            const v = s.get(sample)
            if (v === undefined || !Number.isFinite(v)) {
              pen = false
              continue
            }
            if (pen) ctx.lineTo(x(sample.raw.t), y(v))
            else ctx.moveTo(x(sample.raw.t), y(v))
            pen = true
          }
          ctx.stroke()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [samplesRef, series, min, max, guides])

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <canvas ref={canvasRef} />
    </figure>
  )
}
