/** Group D — microsleep that must alert (in time). */
import { CLOSED, LOST, repeat, road, seg, SPEED } from '../looks.ts'
import type { Scenario } from '../types.ts'

export const GROUP_D: readonly Scenario[] = [
  {
    id: 'D01', title: 'Heavy eyelids: ~55% closed for 6 s',
    testType: 'S', fixes: ['heavy-lid rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(6000, { ear: 0.17, blink: 0.5 }, undefined, 'heavy'), road(2000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'heavy', within: 4000 }],
  },
  {
    id: 'D02', title: 'Sleeping with eyes half open: no eye movement, head slowly sinking',
    testType: 'S,R', fixes: ['stare rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), ...repeat(8, [seg(1000, { ear: 0.2, blink: 0.3 })]).map((s, i) => ({ ...s, look: { ...s.look, pitch: -i }, ...(i === 0 && { mark: 'stare' }) }))],
    expect: [{ kind: 'alarm', family: 'L', after: 'stare', within: 8000 }],
  },
  {
    id: 'D03', title: 'Head drops first; the face is lost before the eyes count as closed',
    testType: 'S', fixes: ['T15'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(150, { pitch: -15, ear: 0.2 }, undefined, 'drop'), seg(150, { pitch: -30, ear: 0.18 }), seg(4000, LOST), road(2000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'drop', within: 1500 }],
  },
  {
    id: 'D04', title: 'Eyes close while the head rolls sideways (2.5 s)',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2500, CLOSED, undefined, 'sleep'), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1200 }],
  },
  {
    id: 'D05', title: 'One noisy "open" frame in the middle of a real closure',
    testType: 'S', fixes: ['T6'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(600, CLOSED, undefined, 'close'), seg(67, { ear: 0.25, blink: 0.2 }), seg(1500, CLOSED), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'close', within: 1200 }],
  },
  {
    id: 'D06', title: 'Eyes close while the head is turned 40° (near eye used)',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(2000, { ...CLOSED, yaw: 40, widthL: 0.05, widthR: 0.09 }, undefined, 'sleep'), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1200 }],
  },
  {
    id: 'D07', title: 'Sunglasses: eyes hidden, degraded mode never starts', testType: 'R', fixes: ['sunglasses detector'],
    clipOnly: 'needs real clips with sunglasses: which signals reveal hidden eyes',
  },
  {
    id: 'D08', title: 'Microsleep while creeping in a traffic jam (5 km/h)',
    testType: 'S,D', fixes: ['T1'], ctx: { speed: 5 },
    segments: [road(3000), seg(2500, CLOSED, undefined, 'sleep'), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1200 }],
  },
  {
    id: 'D09', title: 'Three near-microsleeps of 0.85 s within 40 s',
    testType: 'S', fixes: ['cluster rule'], ctx: { speed: SPEED.road },
    segments: [road(3000), seg(850, CLOSED), road(12_000), seg(850, CLOSED), road(12_000), seg(850, CLOSED, undefined, 'third'), road(5000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'third', within: 2000 }],
  },
  {
    id: 'D10', title: 'Slow phone at 8 fps: 2.2 s closure',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road }, fps: 8,
    segments: [road(3000), seg(2200, CLOSED, undefined, 'sleep'), road(3000)],
    expect: [{ kind: 'alarm', family: 'L', after: 'sleep', within: 1250 }],
  },
]
