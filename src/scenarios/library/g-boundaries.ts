/**
 * Group G — boundary pairs (P6). Each threshold gets a case just under it (no
 * alarm) and one just over it (alarm in time). Without these, the ratchet would
 * not notice a threshold getting tighter or looser (found in P1).
 *
 * Margins: about 0.3–0.5 s on each side of today's measured alarm time (the
 * config value plus ~0.2 s of zone debounce and smoothing). A change of roughly
 * 15–20% in a threshold breaks one side of its pair.
 */
import { CLOSED, CLUSTER, LAP, LEFT_CHECK, LOST, MIRROR_L, REARVIEW, repeat, road, seg, SPEED } from '../looks.ts'
import type { Scenario } from '../types.ts'

const YAWN_CLOSED = { ...CLOSED, jaw: 0.9, mar: 0.7 }
const HEAVY = { ear: 0.17, blink: 0.5 }

export const GROUP_G: readonly Scenario[] = [
  {
    id: 'G01', title: 'Phone in the lap for 1.8 s (budget 2.0 s): no alarm',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1800, LAP), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G02', title: 'Phone in the lap: D1 by 2.5 s, D2 by 4.0 s',
    testType: 'S', fixes: ['T4'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(5000, LAP, undefined, 'phone'), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'phone', within: 2500 }, { kind: 'level', level: 'D2', after: 'phone', within: 4000 }],
  },
  {
    id: 'G03', title: 'Left mirror for 2.3 s (budget 2.5 s): no alarm',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2300, MIRROR_L), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G04', title: 'Left mirror held too long: D1 by 3.0 s',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4000, MIRROR_L, undefined, 'look'), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'look', within: 3000 }],
  },
  {
    id: 'G05', title: 'Rear-view mirror for 2.8 s (budget 3.0 s): no alarm',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2800, REARVIEW), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G06', title: 'Rear-view mirror held too long: D1 by 3.5 s',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4500, REARVIEW, undefined, 'look'), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'look', within: 3500 }],
  },
  {
    id: 'G07', title: 'Speedometer for 1.8 s (budget 2.0 s): no alarm',
    testType: 'S', fixes: ['T3', 'T8'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1800, CLUSTER), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G08', title: 'Speedometer stared at: D1 by 2.5 s',
    testType: 'S', fixes: ['T3'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(4000, CLUSTER, undefined, 'look'), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'look', within: 2500 }],
  },
  {
    id: 'G09', title: 'Slow speed: side look for 3.3 s (budget 3.5 s): no alarm',
    testType: 'S', fixes: ['T1'], ctx: { speed: SPEED.slow },
    segments: [road(3000), seg(3300, LEFT_CHECK), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G10', title: 'Slow speed: side look held too long: D1 by 4.0 s',
    testType: 'S', fixes: ['T1'], ctx: { speed: SPEED.slow },
    segments: [road(3000), seg(5000, LEFT_CHECK, undefined, 'look'), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'look', within: 4000 }],
  },
  {
    id: 'G11', title: 'Shoulder check, face lost 1.2 s after a fast turn (allowance 1.5 s): no alarm',
    testType: 'S', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(150, { yaw: -25 }), seg(1200, LOST), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G12', title: 'Face lost after a fast turn and stays away: D1 by 1.9 s',
    testType: 'S', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(150, { yaw: -25 }, undefined, 'turn'), seg(3000, LOST), road(3000)],
    expect: [{ kind: 'level', level: 'D1', after: 'turn', within: 1900 }],
  },
  {
    id: 'G13', title: 'One long blink of 0.9 s (microsleep at 1.0 s): no alarm',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(900, CLOSED), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    // Microsleep timing is the most safety-critical value: only 0.1 s of slack.
    id: 'G14', title: 'Eyes closed: L1 by 1.1 s, L2 by 1.6 s, L3 by 2.1 s',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(3000, CLOSED, undefined, 'sleep'), road(3000)],
    expect: [
      { kind: 'level', level: 'L1', after: 'sleep', within: 1100 },
      { kind: 'level', level: 'L2', after: 'sleep', within: 1600 },
      { kind: 'level', level: 'L3', after: 'sleep', within: 2100 },
    ],
  },
  {
    id: 'G15', title: 'Yawn with the eyes shut for 1.7 s (2.0 s during an expression): no alarm',
    testType: 'S', fixes: ['T9'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(1700, YAWN_CLOSED), road(3000)], expect: [{ kind: 'noAlarm', family: 'L' }],
  },
  {
    id: 'G16', title: 'Yawn, but the eyes stay shut: L1 by 2.3 s',
    testType: 'S', fixes: ['T9'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(3000, YAWN_CLOSED, undefined, 'yawn'), road(3000)],
    expect: [{ kind: 'level', level: 'L1', after: 'yawn', within: 2300 }],
  },
  {
    id: 'G17', title: 'Heavy lids for 2.6 s (rule at 3.0 s): no alarm',
    testType: 'S', fixes: ['heavy-lid rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2600, HEAVY), road(3000)], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G18', title: 'Heavy lids that stay: L1 by 3.5 s',
    testType: 'S', fixes: ['heavy-lid rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(5000, HEAVY, undefined, 'heavy'), road(3000)],
    expect: [{ kind: 'level', level: 'L1', after: 'heavy', within: 3500 }],
  },
  {
    id: 'G19', title: 'Three long blinks of 0.55 s within 40 s (near-microsleep needs 0.7 s): no alarm',
    testType: 'S', fixes: ['cluster rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), ...repeat(3, [seg(550, CLOSED), road(12_000)])], expect: [{ kind: 'noAlarm' }],
  },
  {
    id: 'G20', title: 'Phone for only 1.5 s at a red light, the car moves off with the eyes still down: no instant alarm',
    testType: 'S,D', fixes: ['T10'],
    segments: [road(3000, { speed: 20 }), seg(1500, LAP, { speed: 0 }), seg(1200, LAP, { speed: 15 }, 'go'), road(3000, { speed: 25 })],
    expect: [{ kind: 'noAlarm', family: 'D' }],
  },
]
