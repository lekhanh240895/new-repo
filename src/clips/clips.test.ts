import { describe, expect, it } from 'vitest'
// ?raw (Vite): src/ has no Node types, so read the file as text through the bundler.
import exampleManifest from '../../docs/clips.manifest.example.json?raw'
import { DEFAULT_CONFIG } from '../core/config.ts'
import type { FrameResult } from '../core/types.ts'
import { frameFor } from '../scenarios/runner.ts'
import { CLOSED, LAP } from '../scenarios/looks.ts'
import type { Look } from '../scenarios/types.ts'
import { checkClip, signCheck } from './check.ts'
import { isSafeClipFile, parseManifest } from './manifest.ts'

/** A fake "recording": [seconds, look] parts at 15 fps, starting at an odd clock time like a real page. */
function recording(parts: [number, Look][], t0 = 12_345.6): FrameResult[] {
  const out: FrameResult[] = []
  let i = 0
  for (const [secs, look] of parts) for (let k = 0; k < Math.round(secs * 15); k++) out.push(frameFor(t0 + (i++ * 1000) / 15, look))
  return out
}
/** 8 s of calibration: road with two blinks. */
const CALIBRATION: [number, Look][] = [[3, {}], [0.2, CLOSED], [2.5, {}], [0.2, CLOSED], [2.1, {}]]

describe('clip manifest (P7)', () => {
  it('reads a valid manifest with defaults', () => {
    const { manifest, errors } = parseManifest({
      clips: [{ id: 'C04', file: 'laugh.mp4', marks: { laugh: 10 }, expect: [{ kind: 'noAlarm', family: 'L' }] }],
    })
    expect(errors).toEqual([])
    expect(manifest.clips[0]).toMatchObject({ id: 'C04', calibrate: [0, 8], speed: [], marks: { laugh: 10 } })
  })

  it('skips bad entries with a clear message instead of guessing', () => {
    const { manifest, errors } = parseManifest({
      clips: [
        { id: 'X1', file: '../secret.mp4', expect: [{ kind: 'noAlarm' }] },
        { id: 'X2', file: 'a.mp4', expect: [{ kind: 'alarm', family: 'L', after: 'nope', within: 1000 }] },
        { id: 'X3', file: 'a.mp4', expect: [{ kind: 'explode' }] },
        { id: 'X4', file: 'a.mp4' },
        { id: 'X5', file: 'a.mp4', calibrate: [5, 2], expect: [{ kind: 'noAlarm' }] },
      ],
    })
    expect(manifest.clips).toEqual([])
    expect(errors).toHaveLength(5)
    expect(errors[0]).toMatch(/plain file name/)
    expect(errors[1]).toMatch(/unknown mark "nope"/)
  })

  it('only allows plain file names inside clips/', () => {
    expect(isSafeClipFile('c03-sun.mp4')).toBe(true)
    for (const bad of ['../x.mp4', '/etc/passwd', 'a/b.mp4', '.hidden', 'a b.mp4', '']) expect(isSafeClipFile(bad), bad).toBe(false)
  })

  it('the example manifest in docs/ is valid', () => {
    const example: unknown = JSON.parse(exampleManifest)
    const { manifest, errors } = parseManifest(example)
    expect(errors).toEqual([])
    expect(manifest.clips.map((c) => c.id)).toContain('SIGNS')
  })

  it('rejects a manifest that is not { clips: [...] }', () => {
    expect(parseManifest([]).errors).toHaveLength(1)
    expect(parseManifest(null).errors).toHaveLength(1)
  })
})

describe('checking a clip with the scenario code', () => {
  const entry = (marks: Record<string, number>, expectations: Parameters<typeof parseManifest>[0]) => {
    const { manifest, errors } = parseManifest({ clips: [{ id: 'T', file: 't.y4m', marks, expect: expectations }] })
    expect(errors).toEqual([])
    return manifest.clips[0]!
  }

  it('calibrates on the first seconds, then finds a microsleep at the right moment', () => {
    const frames = recording([...CALIBRATION, [3, {}], [2.5, CLOSED], [3, {}]])
    const r = checkClip(frames, entry({ sleep: 11 }, [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1300 }]))
    expect(r.calibration).toMatch(/^ok/)
    expect(r.reasons).toEqual([])
    expect(r.status).toBe('pass')
    expect(r.timeline[0]).toMatch(/^12\.\ds alarm:L1$/)
  })

  it('fails with the reason when the app does something else', () => {
    const frames = recording([...CALIBRATION, [3, {}], [3, LAP], [2, {}]])
    const r = checkClip(frames, entry({ phone: 11 }, [{ kind: 'noAlarm', family: 'D' }]))
    expect(r.status).toBe('fail')
    expect(r.reasons[0]).toMatch(/unexpected D1/)
  })

  it('uses the speed changes: no distraction alarm while stopped', () => {
    const frames = recording([...CALIBRATION, [5, LAP], [2, {}]])
    const { manifest } = parseManifest({ clips: [{ id: 'T', file: 't.y4m', speed: [{ at: 0, kmh: 0 }], expect: [{ kind: 'noAlarm', family: 'D' }] }] })
    expect(checkClip(frames, manifest.clips[0]!).status).toBe('pass')
  })

  it('counts marks from the video start, not from the first analyzed frame (model loading)', () => {
    // The model needed 2 s to load: frames start 2 s into the video.
    const frames = recording([...CALIBRATION, [3, {}], [2.5, CLOSED], [3, {}]], 12_345.6)
    const r = checkClip(frames, entry({ sleep: 13 }, [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1300 }]), undefined, 12_345.6 - 2000)
    expect(r.status).toBe('pass')
    expect(r.timeline[0]).toMatch(/^14\.\ds alarm:L1$/)
  })

  it('accepts a "speaks" expectation (sunglasses → "eyes hidden", D07)', () => {
    const { errors } = parseManifest({ clips: [{ id: 'D07', file: 'sun.mp4', expect: [{ kind: 'speaks', message: 'eyesHidden' }] }] })
    expect(errors).toEqual([])
  })

  it('reports an empty recording instead of crashing', () => {
    expect(checkClip([], entry({}, [{ kind: 'noAlarm' }])).reasons[0]).toMatch(/no frames/)
  })
})

describe('sign check from a short clip', () => {
  const windows = { straight: [0, 3] as [number, number], headRight: [3, 6] as [number, number], headDown: [6, 9] as [number, number], eyesRight: [9, 12] as [number, number], eyesDown: [12, 15] as [number, number] }
  // frameFor maps physical directions with the current config, so a correct config must come out "ok".
  const clip = recording([[3, {}], [3, { yaw: 40 }], [3, { pitch: -25 }], [3, { gazeX: 0.6 }], [3, { gazeY: -0.6 }]])

  it('confirms the current signs when the phone agrees with them', () => {
    const r = signCheck(clip, windows)
    expect(r.map((x) => [x.setting, x.ok])).toEqual([
      ['pose.headDownSign', true],
      ['pose.yawRightSign', true],
      ['pose.gazeXRightSign', true],
      ['blendshape lookX agrees with iris x', true],
      ['iris y when looking down', true],
      ['blendshape lookY when looking down', true],
    ])
  })

  it('recommends the flipped value when this phone reports the other way', () => {
    const flipped = { ...DEFAULT_CONFIG, pose: { ...DEFAULT_CONFIG.pose, yawRightSign: -1 as const } }
    const yaw = signCheck(clip, windows, flipped).find((x) => x.setting === 'pose.yawRightSign')
    expect(yaw).toMatchObject({ current: -1, recommended: 1, ok: false })
  })

  it('says "cannot tell" when a movement is missing or too small', () => {
    const r = signCheck(recording([[3, {}], [3, { yaw: 3 }]]), { straight: [0, 3], headRight: [3, 6] })
    expect(r.find((x) => x.setting === 'pose.yawRightSign')?.ok).toBeNull()
    expect(r.find((x) => x.setting === 'pose.headDownSign')?.measured).toBe('not recorded')
  })

  it('says why a movement was not recorded: the face was lost', () => {
    const r = signCheck(recording([[3, {}], [3, { face: false }]]), { straight: [0, 3], headRight: [3, 6] })
    expect(r.find((x) => x.setting === 'pose.yawRightSign')?.measured).toBe('not recorded (face lost in 100% of 3–6 s)')
  })
})
