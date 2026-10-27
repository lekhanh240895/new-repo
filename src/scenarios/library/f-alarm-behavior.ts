/** Group F — alarm behavior and sensor issues. */
import { computeBaseline } from '../../core/calibration/baseline.ts'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import { framesFrom } from '../../test/frames.ts'
import { pickDriverIndex } from '../../vision/features.ts'
import { CLOSED, MIRROR_L, PHONE_MOUNT, repeat, road, seg, SPEED } from '../looks.ts'
import type { Scenario } from '../types.ts'

export const GROUP_F: readonly Scenario[] = [
  {
    id: 'F01', title: 'Driver looks at the phone to see the D alarm, then back at the road: stop within 1.2 s',
    testType: 'S', fixes: ['T10'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2300, { yaw: -60 }), seg(1500, PHONE_MOUNT), road(3000, undefined, 'back')],
    expect: [{ kind: 'stops', after: 'back', within: 1200 }],
  },
  {
    id: 'F02', title: 'After an L3 alarm the eyes are wide open, but the head points at the phone: step down',
    testType: 'S', fixes: ['T10'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2300, CLOSED), seg(3000, PHONE_MOUNT, undefined, 'awake'), road(3000)],
    expect: [{ kind: 'deescalates', after: 'awake', within: 1500 }],
  },
  {
    id: 'F03', title: 'A short mirror glance during recovery must not restart the 2 s count',
    testType: 'S', fixes: ['T10'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1700, CLOSED), road(1200, undefined, 'open'), seg(600, MIRROR_L), road(4000)],
    expect: [{ kind: 'stops', after: 'open', within: 2600 }],
  },
  {
    id: 'F04', title: 'Long tunnel, too dark for 30 s: honest "monitoring off", no alarms',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(30_000, { face: false, luma: 15 }), road(3000)],
    expect: [{ kind: 'noAlarm' }, { kind: 'chime', chime: 'monitoringOff' }],
  },
  {
    id: 'F05', title: 'Leaving a tunnel: 1 s over-exposure',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1000, { face: false, luma: 250 }), road(3000)],
    expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'F06', title: 'Bumpy rural road (strong shake) + eyes closed 2 s: must still alarm',
    testType: 'S', fixes: ['shake gate'], ctx: { speed: 40 },
    segments: [road(3000, undefined), seg(2000, { jitter: 0.03 }), seg(2200, { ...CLOSED, jitter: 0.03 }, undefined, 'sleep'), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1200 }],
  },
  {
    id: 'F07', title: 'Passenger leans toward the driver position: the driver stays selected',
    testType: 'S', fixes: [],
    check: () => {
      const driver = { x: 0.35, y: 0.2, w: 0.3, h: 0.4 }
      const passenger = { x: 0.45, y: 0.15, w: 0.35, h: 0.45 } // larger and close by
      return pickDriverIndex([passenger, driver], { x: 0.5, y: 0.4 }) === 1 ? null : 'passenger was picked as the driver'
    },
  },
  {
    id: 'F08', title: 'Night: face not visible for 20 s: honest "monitoring off", no alarms',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(20_000, { face: false, luma: 8 })],
    expect: [{ kind: 'noAlarm' }, { kind: 'chime', chime: 'monitoringOff' }],
  },
  {
    id: 'F09', title: 'City driving: left-mirror looks of 2.2 s every 15 s for 5 minutes: at most 1 alarm per 30 s',
    testType: 'S', fixes: ['T10', 'T3'], ctx: { speed: SPEED.city },
    segments: [road(2000), ...repeat(20, [seg(2200, MIRROR_L), road(12_800)])],
    expect: [{ kind: 'maxAlarms', family: 'D', count: 10 }],
  },
  {
    id: 'F10', title: 'Calibration while looking around at a red light is rejected',
    testType: 'S', fixes: ['T7'],
    check: () => {
      const frames = framesFrom([
        { ms: 1500 }, { ms: 200, spec: { ear: 0.05, blink: 0.95 } },
        { ms: 2000, spec: { yaw: -40 } }, { ms: 200, spec: { ear: 0.05, blink: 0.95 } },
        { ms: 2000, spec: { yaw: 35 } }, { ms: 2100 },
      ])
      const r = computeBaseline(frames, DEFAULT_CONFIG.calibration)
      return !r.ok && r.reason === 'moving' ? null : `expected rejection "moving", got ${r.ok ? 'ok' : r.reason}`
    },
  },
]
