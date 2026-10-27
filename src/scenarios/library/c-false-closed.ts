/** Group C — false "eyes closed": these must not raise microsleep (L) alarms. */
import { CLOSED, CLUSTER_DEEP, LAP_LOW_LIDS, like, LOST, repeat, road, seg, SPEED } from '../looks.ts'
import type { Scenario } from '../types.ts'

const noL = [{ kind: 'noAlarm', family: 'L' }] as const

export const GROUP_C: readonly Scenario[] = [
  {
    id: 'C01', title: 'Speedometer glance (1.4 s): lids drop so much it looks "closed"',
    testType: 'S,R', fixes: ['T8'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1400, CLUSTER_DEEP), road(3000)], expect: noL,
    assumptions: ['A deep speedometer glance lowers EAR ~65% and raises the blink score to ~0.55'],
  },
  {
    id: 'C02', title: 'Phone in the lap read as microsleep: must be a distraction alarm instead',
    testType: 'S,R', fixes: ['T3', 'T8'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(3000, like(LAP_LOW_LIDS, { pitch: -20, gazeY: -0.9, ear: 0.09, blink: 0.6 }), undefined, 'phone'), road(3000)],
    expect: [{ kind: 'noAlarm', family: 'L' }, { kind: 'alarm', family: 'D', after: 'phone', within: 2500 }],
  },
  {
    id: 'C03', title: 'Squinting into a low sun for minutes', testType: 'R', fixes: ['T8'],
    clipOnly: 'needs a real clip: how MediaPipe EAR and eyeSquint behave in strong sun',
  },
  {
    id: 'C04', title: 'Laughing hard: eyes squeezed for 1.6 s',
    testType: 'S,R', fixes: ['T9'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1600, { ear: 0.07, blink: 0.85, mar: 0.5, jaw: 0.5, future: { smile: 0.9, eyeSquint: 0.8 } }), road(3000)],
    expect: noL,
  },
  {
    id: 'C05', title: 'Sneezing: eyes shut 1.1 s with a head jerk',
    testType: 'S,R', fixes: ['T9'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(300, { ...CLOSED, pitch: 8, mar: 0.4, jaw: 0.4 }), seg(400, { ...CLOSED, pitch: -15 }), seg(400, { ...CLOSED, pitch: -5 }), road(3000)],
    expect: noL,
  },
  {
    id: 'C06', title: 'Yawning with the eyes squeezed for 1.6 s',
    testType: 'S,R', fixes: ['T9'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(700, { jaw: 0.9, mar: 0.7 }), seg(1600, { ...CLOSED, jaw: 0.9, mar: 0.7, future: { eyeSquint: 0.8 } }), seg(700, { jaw: 0.6, mar: 0.5 }), road(3000)],
    expect: noL,
  },
  {
    id: 'C07', title: 'Rubbing the eyes: a blink, then the hand covers the face for 1.5 s',
    testType: 'S,R', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(500, CLOSED), seg(1500, like(LOST, { future: { handOnFace: true } })), road(3000)],
    expect: noL,
  },
  {
    id: 'C08', title: 'Resting the eyes 3 s at a red light: advisory, not an alarm',
    testType: 'S,D', fixes: ['T1'],
    segments: [road(3000, { speed: 20 }), seg(1000, {}, { speed: 0 }), seg(3000, CLOSED, { speed: 0 }, 'rest'), road(3000, { speed: 0 })],
    expect: [{ kind: 'noAlarm', family: 'L' }, { kind: 'advisory', after: 'rest', within: 6000 }],
  },
  {
    id: 'C09', title: 'Narrow eyes + head-down posture for 20 s',
    testType: 'S,R', fixes: ['T8'], ctx: { speed: SPEED.road }, baseline: { earOpen: 0.17, earClosed: 0.04 },
    segments: [road(3000, undefined), seg(20_000, { ear: 0.1, blink: 0.45, pitch: -10 })], expect: noL,
  },
  {
    id: 'C10', title: 'Light reflection on glasses hides one eye', testType: 'R', fixes: ['T8'],
    clipOnly: 'needs a real clip: what the eye landmarks do under a lens reflection',
  },
  {
    id: 'C11', title: 'Winking / one eye closed for 1.5 s',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1500, { earL: 0.05, blinkL: 0.95 }), road(3000)], expect: noL,
  },
  {
    id: 'C12', title: 'Droopy eyelid on one side (ptosis), whole trip',
    testType: 'S', fixes: ['T8'], ctx: { speed: SPEED.road },
    segments: [seg(30_000, { earL: 0.15, blinkL: 0.4 })], expect: noL,
  },
  {
    id: 'C13', title: 'Dusk: noisy EAR reads "closed" on 30% of frames for 70 s',
    testType: 'S', fixes: ['T6'], ctx: { speed: SPEED.road },
    segments: repeat(300, [seg(67, { ear: 0.07, blink: 0.6, luma: 60 }), seg(133, { ear: 0.28, luma: 60 })]),
    expect: [{ kind: 'noAlarm', family: 'L' }, { kind: 'noAdvisory' }],
  },
  {
    id: 'C14', title: 'Auto-exposure jump under a bridge: 2 bad frames',
    testType: 'S', fixes: ['T6'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(133, { ear: 0.05, blink: 0.7, luma: 230 }), road(3000)], expect: noL,
  },
  {
    id: 'C15', title: 'Hard braking + speedometer glance (1.2 s)',
    testType: 'S', fixes: ['T8'], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(1200, CLUSTER_DEEP, { brake: true }), road(3000)], expect: noL,
  },
  {
    id: 'C16', title: 'Cap shadow over the eyes', testType: 'R', fixes: ['T8'],
    clipOnly: 'needs a real clip: eye-region darkness vs EAR noise',
  },
  {
    id: 'C17', title: 'Head turned 60°: both eyes foreshortened (1.5 s)',
    testType: 'S', fixes: ['T8'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1500, { yaw: 60, ear: 0.08, blink: 0.3, widthL: 0.03, widthR: 0.05 }), road(3000)], expect: noL,
    assumptions: ['At 60° the near eye still reads EAR ≈ 0.08 and blink ≈ 0.3 (passes today); a real clip may show lower values'],
  },
  {
    id: 'C18', title: 'Makeup / eyelash extensions', testType: 'R', fixes: [],
    clipOnly: 'needs a real clip: calibration with heavy eye makeup',
  },
]
