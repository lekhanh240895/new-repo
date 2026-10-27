/**
 * Group B — REAL distraction: these must alert (in time, and as distraction).
 * B11–B14 are guards: they stop the group-A fixes from hiding real distraction.
 */
import { CONSOLE, LAP, LAP_LOW_LIDS, like, LOST, PASSENGER, ramp, repeat, ROAD, road, seg, SPEED } from '../looks.ts'
import type { Scenario } from '../types.ts'

export const GROUP_B: readonly Scenario[] = [
  {
    id: 'B01', title: 'Texting with the phone in the lap: head almost straight, lids low',
    testType: 'S,R', fixes: ['T3', 'T8'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4000, LAP_LOW_LIDS, undefined, 'phone'), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'phone', within: 2500 }, { kind: 'noAlarm', family: 'L' }],
    assumptions: ['Looking down at a lap phone lowers EAR ~65% and raises the blink score to ~0.55'],
  },
  {
    id: 'B02', title: 'Repeated phone glances: 1.5 s phone, 1 s road, for 30 s',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1500, LAP, undefined, 'phone'), road(1000), ...repeat(11, [seg(1500, LAP), road(1000)])],
    expect: [{ kind: 'alarm', family: 'D', after: 'phone', within: 8000 }],
  },
  {
    id: 'B03', title: 'Phone held low behind the steering wheel: small eyes-down angle',
    testType: 'S,R', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(5000, { pitch: -8, gazeY: -0.45, ear: 0.22, future: { eyeLookDown: 0.6 } }, undefined, 'phone'), road(2000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'phone', within: 2500 }],
  },
  {
    id: 'B04', title: 'Long talk with a passenger at speed (head 38°, 4 s)',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4000, like(PASSENGER, { yaw: 38 }), undefined, 'look'), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'look', within: 2500 }],
  },
  {
    id: 'B05', title: 'Phone at a red light; the car moves off while the eyes are still down',
    testType: 'S,D', fixes: ['T10'],
    segments: [road(3000, { speed: 20 }), seg(8000, LAP, { speed: 0 }), seg(3000, LAP, { speed: 15 }, 'go'), road(3000, { speed: 25 })],
    expect: [{ kind: 'alarm', family: 'D', after: 'go', within: 1000 }],
  },
  {
    id: 'B06', title: 'Turning to the back seat at speed: face lost almost at once',
    testType: 'S', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(150, { yaw: -25 }, undefined, 'turn'), seg(3000, LOST), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'turn', within: 2000 }],
  },
  {
    id: 'B07', title: 'Eating while driving: head down 22°, hand hides the face on and off',
    testType: 'S,R', fixes: ['T3', 'T15'], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(700, { pitch: -22 }, undefined, 'eat'), ...repeat(5, [seg(300, like(LOST, { future: { handOnFace: true } })), seg(700, { pitch: -22 })]), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'eat', within: 2500 }],
  },
  {
    id: 'B08', title: 'Reading a paper on the steering wheel (head −12°, eyes slightly down)',
    testType: 'S,R', fixes: ['T3'], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(5000, { pitch: -12, gazeY: -0.48, future: { eyeLookDown: 0.6 } }, undefined, 'read'), road(2000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'read', within: 2500 }],
  },
  {
    id: 'B09', title: 'Rubbernecking at a crash (head 45°, 3.5 s at speed)',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(3500, { yaw: 45 }, undefined, 'look'), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'look', within: 2500 }],
  },
  {
    id: 'B10', title: 'Watching a video on the center screen (3.5 s)',
    testType: 'S', fixes: ['T3', 'T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(3500, CONSOLE, undefined, 'look'), road(3000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'look', within: 2500 }],
  },
  {
    id: 'B11', title: 'Guard (T7): driver looks at the lap phone 30% of the time; re-centering must not drift there',
    testType: 'S', fixes: ['T7'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1200, LAP, undefined, 'phone'), road(2800), ...repeat(14, [seg(1200, LAP), road(2800)])],
    // 1.2 s glances never empty a 2 s attention buffer; the "> 6 s on the phone within 30 s" rule
    // catches it at the 6th glance (~20 s). This guard keeps that rule from getting weaker.
    expect: [{ kind: 'alarm', family: 'D', after: 'phone', within: 25_000 }],
  },
  {
    id: 'B12', title: 'Guard (T5): phone ↔ road alternation must not count as "scanning"',
    testType: 'S', fixes: ['T5'], ctx: { speed: 20 },
    segments: [road(3000), seg(1400, LAP, undefined, 'phone'), road(1000), ...repeat(8, [seg(1400, LAP), road(1000)])],
    expect: [{ kind: 'alarm', family: 'D', after: 'phone', within: 12_000 }],
  },
  {
    id: 'B13', title: 'Guard (T1): GPS lost in a tunnel (speed unknown): alarms stay on',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: null },
    segments: [road(3000), seg(3000, { yaw: -50 }, undefined, 'look'), road(2000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'look', within: 2500 }],
  },
  {
    id: 'B14', title: 'Guard (T2): smooth highway, accelerometer reads "still", GPS says 90 km/h',
    testType: 'S,D', fixes: ['T2'], ctx: { speed: 90, accelStill: true },
    segments: [road(4000), ...ramp(200, ROAD, { yaw: -50 }, 2), seg(2800, { yaw: -50 }, undefined, 'look'), road(2000)],
    expect: [{ kind: 'alarm', family: 'D', after: 'look', within: 2500 }],
  },
]
