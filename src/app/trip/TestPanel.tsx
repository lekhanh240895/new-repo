import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import type { AlertLevel } from '../../core/fsm/types.ts'
import type { GazeZone, SpeedClass } from '../../core/types.ts'
import type { Lang } from '../i18n.ts'
import type { TripSnapshot } from './controller.ts'

/**
 * Behavior check for testing at a desk: shows what the detectors see, whether alarms are
 * armed, and judges a test action against what the rules say should happen.
 * Developer tool (open with ?test or the box on the start screen); never shown by default.
 */

type CaseId = 'right' | 'left' | 'phone' | 'mirror' | 'eyes'
type Family = 'D' | 'L'

interface TestCase {
  id: CaseId;
  /** Alarm family expected, or null when nothing should sound. */
  expect: Family | null;
}

const CASES: readonly TestCase[] = [
  { id: 'right', expect: 'D' },
  { id: 'left', expect: 'D' },
  { id: 'phone', expect: 'D' },
  { id: 'mirror', expect: null },
  { id: 'eyes', expect: 'L' },
]

/** How long a test runs after the button is pressed. */
const WINDOW_MS = 10_000

const TEXT = {
  vi: {
    title: 'Bảng kiểm tra hành vi',
    armed: 'Báo động',
    armedAll: 'BẬT (không dùng vị trí)',
    armedOn: 'BẬT',
    armedNoD: 'TẮT báo nhìn lệch — app tưởng xe đang đỗ. Bỏ tick "Dùng vị trí" rồi bắt đầu lại.',
    armedOff: 'TẮT hoàn toàn — xe đang dừng',
    look: 'Đang nhìn',
    head: 'Đầu',
    right: 'quay phải',
    left: 'quay trái',
    down: 'cúi',
    up: 'ngẩng',
    eyes: 'Mắt',
    eyesOpen: 'mở',
    eyesClosed: 'nhắm',
    noFace: 'Không thấy mặt',
    buffer: 'Bộ đệm chú ý',
    bufferHelp: 'về 0 thì báo "nhìn đường"',
    budget: 'Được nhìn vùng này tối đa',
    safe: 'vùng an toàn',
    alert: 'Cảnh báo hiện tại',
    none: 'không có',
    testTitle: 'Thử một hành vi',
    start: 'Bắt đầu thử (10 giây)',
    running: 'Đang đo… làm hành động ngay',
    result: 'Kết quả',
    pass: 'ĐÚNG như mong đợi',
    fail: 'KHÁC mong đợi',
    expectedLabel: 'Mong đợi',
    gotLabel: 'Thực tế',
    expD: 'báo nhìn lệch (D)',
    expL: 'báo ngủ gật (L)',
    expNone: 'không báo gì',
    gotNone: 'không báo gì',
    gotD: 'báo nhìn lệch (D)',
    gotL: 'báo ngủ gật (L)',
    hintDisarmed: 'Báo nhìn lệch đang tắt: bỏ tick "Dùng vị trí".',
    hintWrongFamily: 'Nghe báo ngủ gật vì mắt bị đọc là nhắm khi quay/cúi: ghi lại số mắt bên trên.',
    hintFalseAlarm: 'Chỉ liếc ngắn mà vẫn báo: ngưỡng quá chặt hoặc vùng bị đọc sai.',
    history: 'Lịch sử cảnh báo',
    historyEmpty: 'Chưa có cảnh báo nào',
    cases: {
      right: 'Quay phải ~40°, giữ trên 3 giây',
      left: 'Quay trái ~40°, giữ trên 3 giây',
      phone: 'Cúi nhìn điện thoại cầm thấp, giữ trên 3 giây',
      mirror: 'Liếc gương 1 giây rồi nhìn lại',
      eyes: 'Nhắm mắt 2 giây',
    },
    zones: {
      road: 'Đường',
      up: 'Phía trên',
      mirrorLeft: 'Gương trái',
      mirrorRight: 'Gương phải',
      rearview: 'Gương chiếu hậu',
      cluster: 'Đồng hồ',
      console: 'Màn hình / radio',
      lap: 'Lòng / điện thoại',
      sideLeft: 'Cửa sổ trái',
      sideRight: 'Cửa sổ phải',
    } as Record<GazeZone, string>,
    alerts: {
      NONE: 'không có',
      ADVISORY: 'Nhắc nghỉ ngơi',
      STRONG_ADVISORY: 'Nhắc nghỉ mạnh',
      D1: 'D1 — nhìn lệch (nhẹ)',
      D2: 'D2 — nhìn lệch (mạnh)',
      L1: 'L1 — mắt nhắm (nhẹ)',
      L2: 'L2 — mắt nhắm (mạnh)',
      L3: 'L3 — mắt nhắm (rất mạnh)',
    } as Record<AlertLevel, string>,
  },
  en: {
    title: 'Behavior check',
    armed: 'Alarms',
    armedAll: 'ON (location not used)',
    armedOn: 'ON',
    armedNoD: 'Look-away alarms OFF — the app thinks the car is parked. Untick "Use location" and start again.',
    armedOff: 'Fully OFF — the car is stopped',
    look: 'Looking at',
    head: 'Head',
    right: 'turned right',
    left: 'turned left',
    down: 'down',
    up: 'up',
    eyes: 'Eyes',
    eyesOpen: 'open',
    eyesClosed: 'closed',
    noFace: 'No face',
    buffer: 'Attention buffer',
    bufferHelp: 'at 0 the "eyes on the road" alarm fires',
    budget: 'Allowed to look here for',
    safe: 'safe zone',
    alert: 'Current alert',
    none: 'none',
    testTitle: 'Try a behavior',
    start: 'Start test (10 s)',
    running: 'Measuring… do the action now',
    result: 'Result',
    pass: 'AS EXPECTED',
    fail: 'DIFFERENT from expected',
    expectedLabel: 'Expected',
    gotLabel: 'Got',
    expD: 'look-away alarm (D)',
    expL: 'drowsy alarm (L)',
    expNone: 'no alarm',
    gotNone: 'no alarm',
    gotD: 'look-away alarm (D)',
    gotL: 'drowsy alarm (L)',
    hintDisarmed: 'Look-away alarms are off: untick "Use location".',
    hintWrongFamily: 'A drowsy alarm fired because the eyes read as closed while turning/looking down: note the eye numbers above.',
    hintFalseAlarm: 'A short glance still alarmed: the limit is too tight or the zone is misread.',
    history: 'Alert history',
    historyEmpty: 'No alerts yet',
    cases: {
      right: 'Turn right ~40°, hold over 3 s',
      left: 'Turn left ~40°, hold over 3 s',
      phone: 'Look down at a phone held low, hold over 3 s',
      mirror: 'Glance at the mirror for 1 s, then look back',
      eyes: 'Close your eyes for 2 s',
    },
    zones: {
      road: 'Road',
      up: 'Above',
      mirrorLeft: 'Left mirror',
      mirrorRight: 'Right mirror',
      rearview: 'Rear-view mirror',
      cluster: 'Speedometer',
      console: 'Console / radio',
      lap: 'Lap / phone',
      sideLeft: 'Left window',
      sideRight: 'Right window',
    } as Record<GazeZone, string>,
    alerts: {
      NONE: 'none',
      ADVISORY: 'Break advisory',
      STRONG_ADVISORY: 'Strong advisory',
      D1: 'D1 — looking away (soft)',
      D2: 'D2 — looking away (strong)',
      L1: 'L1 — eyes closed (soft)',
      L2: 'L2 — eyes closed (strong)',
      L3: 'L3 — eyes closed (very strong)',
    } as Record<AlertLevel, string>,
  },
} as const

const BUDGET_MS: Partial<Record<GazeZone, number>> = {
  mirrorLeft: DEFAULT_CONFIG.budgets.mirrorMs,
  mirrorRight: DEFAULT_CONFIG.budgets.mirrorMs,
  rearview: DEFAULT_CONFIG.budgets.rearviewMs,
  sideLeft: DEFAULT_CONFIG.budgets.sideMs,
  sideRight: DEFAULT_CONFIG.budgets.sideMs,
  cluster: DEFAULT_CONFIG.budgets.clusterMs,
  console: DEFAULT_CONFIG.budgets.consoleMs,
  lap: DEFAULT_CONFIG.budgets.lapMs,
}

const familyOf = (a: AlertLevel): Family | null => (a === 'D1' || a === 'D2' ? 'D' : a === 'L1' || a === 'L2' || a === 'L3' ? 'L' : null)

type ArmedState = 'all' | 'on' | 'noD' | 'off'

function armedState(sc: SpeedClass | null): ArmedState {
  if (sc === null) return 'all'
  if (sc === 'stopped') return 'off'
  if (sc === 'maneuver') return 'noD'
  return 'on'
}

interface Run {
  caseId: CaseId;
  startedAt: number;
  seen: Set<Family>;
}

interface HistoryItem {
  at: number;
  alert: AlertLevel;
  zone: GazeZone | null;
}

const fmtSec = (ms: number) => (ms / 1000).toFixed(1)

export function TestPanel({ snap, lang }: { snap: TripSnapshot; lang: Lang }) {
  const x = TEXT[lang]
  const d = snap.debug
  const alert = snap.session.monitoring.alert
  const [caseId, setCaseId] = useState<CaseId>('right')
  const [run, setRun] = useState<Run | null>(null)
  const [verdict, setVerdict] = useState<{ caseId: CaseId; seen: ReadonlySet<Family> } | null>(null)
  const [history, setHistory] = useState<readonly HistoryItem[]>([])
  const [secondsLeft, setSecondsLeft] = useState(0)
  const runRef = useRef<Run | null>(null)
  const startedAt = useRef(0)
  const zoneRef = useRef<GazeZone | null>(null)
  const zone = d?.zone ?? null
  useEffect(() => {
    runRef.current = run
    zoneRef.current = zone
  })
  useEffect(() => {
    startedAt.current = performance.now()
  }, [])

  // Record every change of the alert, with where the driver was looking.
  const lastAlert = useRef<AlertLevel>('NONE')
  useEffect(() => {
    if (alert === lastAlert.current) return
    lastAlert.current = alert
    if (alert === 'NONE') return
    setHistory((h) => [{ at: performance.now() - startedAt.current, alert, zone: zoneRef.current }, ...h].slice(0, 8))
    const r = runRef.current
    const fam = familyOf(alert)
    if (r !== null && fam !== null) r.seen.add(fam)
  }, [alert])

  // Close the test window after 10 s.
  useEffect(() => {
    if (run === null) return
    const id = setInterval(() => {
      const left = WINDOW_MS - (performance.now() - run.startedAt)
      setSecondsLeft(Math.max(0, Math.ceil(left / 1000)))
      if (left <= 0) {
        setVerdict({ caseId: run.caseId, seen: new Set(run.seen) })
        setRun(null)
      }
    }, 250)
    return () => clearInterval(id)
  }, [run])

  const begin = () => {
    setVerdict(null)
    const r: Run = { caseId, startedAt: performance.now(), seen: new Set() }
    // An alarm already ringing does not count: the test needs a fresh one.
    setSecondsLeft(WINDOW_MS / 1000)
    setRun(r)
  }

  const armed = armedState(d?.speedClass ?? null)
  const budget = zone === null ? undefined : BUDGET_MS[zone]
  const capacity = DEFAULT_CONFIG.attention.capacityMs
  const buffer = snap.session.monitoring.buffer ?? capacity
  const yaw = d?.yawDeg ?? null
  const down = d?.downDeg ?? null
  const closed = d !== null && d.openness !== null ? d.openness < d.closedLine : null

  const tc = CASES.find((c) => c.id === (verdict?.caseId ?? caseId))
  const expectedText = tc?.expect === 'D' ? x.expD : tc?.expect === 'L' ? x.expL : x.expNone
  const gotText = verdict === null ? '' : verdict.seen.size === 0 ? x.gotNone : [...verdict.seen].map((f) => (f === 'D' ? x.gotD : x.gotL)).join(' + ')
  const passed = verdict !== null && tc !== undefined && (tc.expect === null ? verdict.seen.size === 0 : verdict.seen.has(tc.expect))
  let hint = ''
  if (verdict !== null && tc !== undefined && !passed) {
    if (tc.expect === null) hint = x.hintFalseAlarm
    else if (verdict.seen.size === 0 && armed === 'noD' && tc.expect === 'D') hint = x.hintDisarmed
    else if (tc.expect === 'D' && verdict.seen.has('L')) hint = x.hintWrongFamily
  }

  return (
    <div className="test-panel" role="region" aria-label={x.title}>
      <h3>{x.title}</h3>
      <dl className="test-grid">
        <div>
          <dt>{x.armed}</dt>
          <dd className={armed === 'noD' || armed === 'off' ? 'bad' : 'good'}>
            {armed === 'all' ? x.armedAll : armed === 'on' ? x.armedOn : armed === 'noD' ? x.armedNoD : x.armedOff}
          </dd>
        </div>
        <div>
          <dt>{x.look}</dt>
          <dd>
            {zone === null ? x.noFace : x.zones[zone]}
            {zone !== null && (budget === undefined ? ` (${x.safe})` : ` — ${x.budget} ${fmtSec(budget)} s`)}
          </dd>
        </div>
        <div>
          <dt>{x.head}</dt>
          <dd>
            {yaw === null || down === null
              ? '–'
              : `${yaw >= 0 ? x.right : x.left} ${Math.abs(yaw).toFixed(0)}° · ${down >= 0 ? x.down : x.up} ${Math.abs(down).toFixed(0)}°`}
          </dd>
        </div>
        <div>
          <dt>{x.eyes}</dt>
          <dd>
            {d === null || d.openness === null ? '–' : `${Math.round(d.openness * 100)}% (${closed === true ? x.eyesClosed : x.eyesOpen}, ≤ ${Math.round(d.closedLine * 100)}%)`}
          </dd>
        </div>
        <div>
          <dt>{x.buffer}</dt>
          <dd>
            <progress max={capacity} value={buffer} /> {fmtSec(buffer)} / {fmtSec(capacity)} s
            <span className="muted small"> · {x.bufferHelp}</span>
          </dd>
        </div>
        <div>
          <dt>{x.alert}</dt>
          <dd className={alert === 'NONE' ? '' : 'bad'}>{x.alerts[alert]}</dd>
        </div>
      </dl>

      <h4>{x.testTitle}</h4>
      <div className="row">
        <select value={caseId} onChange={(e) => setCaseId(e.target.value as CaseId)} disabled={run !== null}>
          {CASES.map((c) => (
            <option key={c.id} value={c.id}>{x.cases[c.id]}</option>
          ))}
        </select>
        <button type="button" className="primary" onClick={begin} disabled={run !== null}>{x.start}</button>
      </div>
      {run !== null && (
        <p role="status">
          {x.running} ({secondsLeft} s)
        </p>
      )}
      {verdict !== null && (
        <div className={`verdict ${passed ? 'good' : 'bad'}`} role="status">
          <strong>{x.result}: {passed ? x.pass : x.fail}</strong>
          <div>{x.expectedLabel}: {expectedText}</div>
          <div>{x.gotLabel}: {gotText}</div>
          {hint !== '' && <div className="small">{hint}</div>}
        </div>
      )}

      <h4>{x.history}</h4>
      {history.length === 0 ? (
        <p className="muted small">{x.historyEmpty}</p>
      ) : (
        <ul className="small">
          {history.map((h) => (
            <li key={`${h.at}-${h.alert}`}>
              {Math.floor(h.at / 60_000)}:{String(Math.floor(h.at / 1000) % 60).padStart(2, '0')} · {x.alerts[h.alert]}
              {h.zone !== null && ` · ${x.zones[h.zone]}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
