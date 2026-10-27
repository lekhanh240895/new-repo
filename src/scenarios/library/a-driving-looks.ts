/** Group A — looking away FOR DRIVING: these should not raise distraction alarms. */
import {
  CLUSTER,
  CONSOLE,
  LEFT_CHECK,
  like,
  LOST,
  MIRROR_L,
  MIRROR_R,
  PASSENGER,
  PHONE_MOUNT,
  ramp,
  REARVIEW,
  repeat,
  ROAD,
  RIGHT_CHECK,
  road,
  seg,
  SPEED,
} from '../looks.ts'
import { mountTooFarToSide } from '../../core/calibration/mount.ts'
import { DEFAULT_CONFIG } from '../../core/config.ts'
import type { Scenario } from '../types.ts'

const noD = [{ kind: 'noAlarm', family: 'D' }] as const

export const GROUP_A: readonly Scenario[] = [
  {
    id: 'A01', title: 'Check left at an intersection before crossing (2.4 s), slow',
    testType: 'S,D', fixes: ['T1', 'T3', 'T5'], ctx: { speed: 12 },
    segments: [road(3000), seg(2400, LEFT_CHECK), road(3000)], expect: noD,
  },
  {
    id: 'A02', title: 'Left-right-left scans at 3 intersections within 30 s',
    testType: 'S', fixes: ['T4', 'T5'], ctx: { speed: SPEED.slow },
    segments: repeat(3, [road(5000), seg(1200, LEFT_CHECK), seg(1200, RIGHT_CHECK), seg(1200, LEFT_CHECK)]), expect: noD,
  },
  {
    id: 'A03', title: 'Stopped at a red light, looking around for 30 s',
    testType: 'S,D', fixes: ['T1', 'T2'],
    segments: [road(3000, { speed: 30 }), seg(8000, LEFT_CHECK, { speed: 0 }), seg(10_000, RIGHT_CHECK, { speed: 0 }), seg(12_000, like(LEFT_CHECK, { pitch: 10 }), { speed: 0 }), road(3000, { speed: 15 })],
    expect: noD,
  },
  {
    id: 'A04', title: 'Stopped at a red light, watching the countdown light (up and to the side, 10 s)',
    testType: 'S,D', fixes: ['T1'],
    segments: [road(3000, { speed: 30 }), seg(10_000, { yaw: 35, pitch: 15 }, { speed: 0 }), road(3000, { speed: 15 })], expect: noD,
  },
  {
    id: 'A05', title: 'Right turn: looking right into the turn for 2.5 s',
    testType: 'S,D', fixes: ['T2', 'T3'], ctx: { speed: SPEED.slow },
    segments: [road(2000), seg(2500, { yaw: 45 }, { turn: 25 }), road(2000)], expect: noD,
  },
  {
    id: 'A06', title: 'Waiting to turn left across traffic (3 km/h): left, right, left',
    testType: 'S,D', fixes: ['T1', 'T5'], ctx: { speed: 3 },
    segments: [road(2000), ...repeat(3, [seg(1500, LEFT_CHECK), seg(1500, RIGHT_CHECK)]), road(2000)], expect: noD,
  },
  {
    id: 'A07', title: 'Lane change: left mirror, then shoulder check (face lost 1 s)',
    testType: 'S', fixes: ['T3', 'T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(600, MIRROR_L), ...ramp(300, MIRROR_L, { yaw: -75 }, 2), seg(1000, LOST), seg(300, MIRROR_L), road(3000)],
    expect: noD,
  },
  {
    id: 'A08', title: 'Lane change right: far right mirror for 2.2 s',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2200, MIRROR_R), road(3000)], expect: noD,
  },
  {
    id: 'A09', title: 'Rear-view mirror glances (1.2 s) every 4 s in heavy traffic',
    testType: 'S', fixes: ['T3', 'T4'], ctx: { speed: SPEED.city },
    segments: [road(2000), ...repeat(10, [seg(1200, REARVIEW), road(2800)])], expect: noD,
    assumptions: ['Rear-view mirror ≈ 32° right, 15° up from the road ahead'],
  },
  {
    id: 'A10', title: 'Left-mirror checks for motorbikes: 1 s every 4 s in city traffic',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.city },
    segments: [road(2000), ...repeat(10, [seg(1000, MIRROR_L), road(3000)])], expect: noD,
  },
  {
    id: 'A11', title: 'Speedometer glances: 1 s every 3 s',
    testType: 'S', fixes: ['T3', 'T4'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(12, [seg(1000, CLUSTER), road(2000)])], expect: noD,
  },
  {
    id: 'A12', title: "Single glances at the car's center screen (1.4 s every 8 s)",
    testType: 'S', fixes: ['T3', 'T4'], ctx: { speed: SPEED.city },
    segments: [road(2000), ...repeat(5, [seg(1400, CONSOLE), road(6600)])], expect: noD,
  },
  {
    id: 'A13', title: 'Reversing into a parking spot: looking back 6 s (face lost) at 5 km/h',
    testType: 'S,D', fixes: ['T1', 'T15'], ctx: { speed: 5 },
    segments: [road(2000), ...ramp(400, ROAD, { yaw: -80 }, 2), seg(6000, LOST), road(2000)], expect: noD,
  },
  {
    id: 'A14', title: 'Parking lot at 8 km/h, looking around',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: 8 },
    segments: [road(2000), seg(3000, LEFT_CHECK), seg(3000, RIGHT_CHECK), seg(3000, MIRROR_L), road(2000)], expect: noD,
  },
  {
    id: 'A15', title: 'Toll booth: stopped, turned to the window for 8 s',
    testType: 'S,D', fixes: ['T1'],
    segments: [road(3000, { speed: 20 }), seg(8000, { yaw: -70, pitch: -5 }, { speed: 0 }), road(3000, { speed: 10 })], expect: noD,
  },
  {
    id: 'A16', title: 'Talking to a passenger while stopped (12 s)',
    testType: 'S,D', fixes: ['T1'],
    segments: [road(3000, { speed: 20 }), seg(12_000, PASSENGER, { speed: 0 }), road(3000, { speed: 15 })], expect: noD,
  },
  {
    id: 'A17', title: 'Short looks at a passenger while driving (0.9 s, then 2.2 s on the road)',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(12, [seg(900, PASSENGER), road(2200)])], expect: noD,
  },
  {
    id: 'A18', title: 'Merging onto a highway: left-mirror check 2.3 s',
    testType: 'S', fixes: ['T3'], ctx: { speed: 70 },
    segments: [road(3000), seg(2300, MIRROR_L), road(3000)], expect: noD,
  },
  {
    id: 'A19', title: 'Roundabout: turning left, head keeps looking left',
    testType: 'S,D', fixes: ['T2', 'T5'], ctx: { speed: SPEED.town, turn: -20 },
    segments: [road(2000, { turn: 0 }), seg(2500, { yaw: -40 }), road(1000), seg(2500, { yaw: -45 }), road(1000), seg(2000, { yaw: -40 }), road(2000, { turn: 0 })],
    expect: noD,
  },
  {
    id: 'A20', title: 'Railway crossing: left, right, left at 12 km/h',
    testType: 'S,D', fixes: ['T1', 'T5'], ctx: { speed: 12 },
    segments: [road(2000), seg(1800, LEFT_CHECK), seg(1800, RIGHT_CHECK), seg(1800, LEFT_CHECK), road(3000)], expect: noD,
  },
  {
    id: 'A21', title: 'School zone at 20 km/h: scanning left and right for 30 s',
    testType: 'S,D', fixes: ['T1', 'T5'], ctx: { speed: 20 },
    segments: [road(2000), ...repeat(5, [seg(1500, LEFT_CHECK), road(2000), seg(1500, RIGHT_CHECK), road(2000)])], expect: noD,
  },
  {
    id: 'A22', title: 'Mountain pass: head follows tight curves (35°) for 3 s each',
    testType: 'S,D', fixes: ['T2', 'T7'], ctx: { speed: 40 },
    segments: [road(2000), ...repeat(4, [seg(3000, { yaw: -35 }, { turn: -30 }), road(800), seg(3000, { yaw: 35 }, { turn: 30 }), road(800)])],
    expect: noD,
  },
  {
    id: 'A23', title: 'Phone mounted far to the side (38°): setup should ask to move it toward the center',
    testType: 'S', fixes: ['T3'],
    check: () => {
      const c = DEFAULT_CONFIG.calibration
      if (!mountTooFarToSide({ yawDeg: 38, approximate: false }, c)) return 'no warning for a 38° mount'
      if (mountTooFarToSide({ yawDeg: -38, approximate: false }, c)) return null
      return 'no warning for a 38° mount on the left'
    },
  },
  {
    id: 'A24', title: 'Driver leans forward mid-trip: head 22° lower, eyes still on the road',
    testType: 'S', fixes: ['T7', 'T3'], ctx: { speed: SPEED.road },
    segments: [road(5000), seg(20_000, { pitch: -22, gazeY: 0.5 })], expect: noD,
  },
  {
    id: 'A25', title: 'Reading an overhead sign (up 20°, 1.8 s)',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1800, { pitch: 20 }), road(3000)], expect: noD,
  },
  {
    id: 'A26', title: 'Quick look at a motorbike cutting in (0.8 s)',
    testType: 'S', fixes: [], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(800, { yaw: 45 }), road(3000)], expect: noD,
  },
  {
    id: 'A27', title: 'Traffic jam crawl (4 km/h): long mirror looks',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: SPEED.crawl },
    segments: [road(2000), seg(4000, MIRROR_L), road(1000), seg(4000, MIRROR_R), road(2000)], expect: noD,
  },
  {
    id: 'A28', title: 'Traffic police at the roadside: look right 2.6 s while slowing (25 km/h)',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: SPEED.town },
    segments: [road(3000), seg(2600, { yaw: 50 }), road(3000)], expect: noD,
  },
  {
    id: 'A29', title: 'Looking for a house number at 15 km/h (2.8 s glances)',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: SPEED.slow },
    segments: [road(2000), ...repeat(4, [seg(2800, { yaw: 60 }), road(3200)])], expect: noD,
  },
  {
    id: 'A30', title: 'Stopped at a food stall, turned to the window (15 s)',
    testType: 'S,D', fixes: ['T1'],
    segments: [road(3000, { speed: 15 }), seg(15_000, { yaw: -65 }, { speed: 0 }), road(3000, { speed: 10 })], expect: noD,
  },
  {
    id: 'A31', title: 'Wiping the fogged windshield: hand hides the face for 4 s',
    testType: 'S,R', fixes: ['T15'], ctx: { speed: 40 },
    segments: [road(3000), seg(4000, like(LOST, { future: { handOnFace: true } })), road(3000)], expect: noD,
  },
  {
    id: 'A32', title: 'Adjusting the rear-view mirror (up-right, 2.6 s)',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(2600, REARVIEW), road(3000)], expect: noD,
  },
  {
    id: 'A33', title: 'During a D1 alarm, a 1.2 s glance at the BioMonitor screen must not escalate it',
    testType: 'S', fixes: ['T3', 'T10'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2300, { yaw: -60 }), road(800), seg(1200, PHONE_MOUNT), road(4000)],
    expect: [{ kind: 'noLevel', level: 'D2' }],
  },
  {
    id: 'A34', title: 'Head turned 35° left, but the eyes are back on the road (4 s)',
    testType: 'S,R', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4000, { yaw: -35, gazeX: 0.7 }), road(3000)], expect: noD,
  },
  {
    id: 'A35', title: 'Eyes-only mirror glance (head straight, eyes far left, 1.5 s)',
    testType: 'S,R', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1500, { gazeX: -0.8 }), road(3000)], expect: noD,
  },
  {
    id: 'A36', title: 'Blind-spot check with the face lost for 1 s',
    testType: 'S', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), ...ramp(400, ROAD, { yaw: -75 }, 2), seg(1000, LOST), road(3000)], expect: noD,
  },
  {
    id: 'A37', title: 'Smiling: iris hard to see, "eyes down" flickers for 20 s',
    testType: 'S,R', fixes: ['T3', 'T6'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(100, [seg(100, { gazeY: -0.6, ear: 0.24, future: { smile: 0.7, eyeLookDown: 0.1 } }), seg(100, { gazeY: -0.3, ear: 0.24, future: { smile: 0.7, eyeLookDown: 0.1 } })])],
    expect: noD,
    assumptions: ['While smiling, the iris reads "down" but the eyeLookDown blendshape stays low (~0.1)'],
  },
  {
    id: 'A38', title: 'Glasses reflection: gaze jumps to "down" on 1 of 4 frames for 40 s',
    testType: 'S,R', fixes: ['T6'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(150, [seg(67, { gazeY: -0.9, future: { eyeLookDown: 0.1 } }), seg(200, {})])], expect: noD,
    assumptions: ['A lens reflection fools the iris geometry, not the eyeLookDown blendshape'],
  },
]
