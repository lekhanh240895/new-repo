/** Group E — fatigue advisory mistakes (false or missed advisories). */
import { CLUSTER_DEEP, LAP, repeat, road, seg, SPEED } from '../looks.ts'
import type { Scenario, Segment } from '../types.ts'

/** Blinks of a given length every 4 s for `minutes`. */
function blinks(minutes: number, blinkMs: number, mark?: string): Segment[] {
  const n = Math.round((minutes * 60_000) / 4000)
  const segs = repeat(n, [road(4000 - blinkMs), seg(blinkMs, { ear: 0.05, blink: 0.95 })])
  return mark === undefined ? segs : [{ ...segs[0]!, mark }, ...segs.slice(1)]
}

export const GROUP_E: readonly Scenario[] = [
  {
    id: 'E01', title: 'Talking / singing for 2 minutes',
    testType: 'S', fixes: [], ctx: { speed: SPEED.road },
    segments: repeat(360, [seg(165, { jaw: 0.1, mar: 0.1 }), seg(165, { jaw: 0.6, mar: 0.4 })]),
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E02', title: 'Chewing gum for 2 minutes',
    testType: 'S', fixes: ['T11'], ctx: { speed: SPEED.road },
    segments: repeat(180, [seg(333, { jaw: 0.3, mar: 0.12 }), seg(333, { jaw: 0.65, mar: 0.2 })]),
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E03', title: 'Yawning behind a hand', testType: 'R', fixes: ['new rule'],
    clipOnly: 'needs real clips: what a hand-covered yawn looks like to the landmarker',
  },
  {
    id: 'E04', title: 'Wearing a face mask', testType: 'R', fixes: ['T11'],
    clipOnly: 'needs real clips with a mask: how MAR and jawOpen behave',
  },
  {
    id: 'E05', title: 'Speedometer glances (0.6 s every 3 s) must not raise PERCLOS or slow-blink counts',
    testType: 'S', fixes: ['T11'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(24, [seg(600, CLUSTER_DEEP), road(2400)])],
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E06', title: 'Road bumps jolt the head (−18°, 0.3 s) every 8 s',
    testType: 'S,D', fixes: ['T2', 'T11'], ctx: { speed: 40 },
    segments: [road(2000), ...repeat(6, [seg(300, { pitch: -18 }, { bump: true }), road(7700)])],
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E07', title: 'Hard braking pitches the head forward (−16°, 0.5 s)',
    testType: 'S,D', fixes: ['T2', 'T11'], ctx: { speed: SPEED.city },
    segments: [road(3000), seg(500, { pitch: -16 }, { brake: true }), road(5000)],
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E08', title: 'Nodding along to music (1.5 Hz) for 20 s',
    testType: 'S', fixes: ['T11'], ctx: { speed: SPEED.road },
    segments: [road(2000), ...repeat(30, [seg(250, { pitch: -16 }), seg(417, {})])],
    expect: [{ kind: 'noAdvisory' }],
  },
  {
    id: 'E09', title: 'PERCLOS raised by squinting in sun', testType: 'R', fixes: ['T8'],
    clipOnly: 'needs real clips in strong sun (same footage as C03)',
  },
  {
    id: 'E10', title: 'Early fatigue: blinks slowly get longer (150 ms → 350 ms) over 20 minutes',
    testType: 'S', fixes: ['trend rule'], ctx: { speed: SPEED.road },
    segments: [...blinks(10, 150), ...blinks(5, 250), ...blinks(5, 350, 'late')],
    expect: [{ kind: 'advisory', after: 'late', within: 300_000 }],
  },
  {
    id: 'E11', title: 'Found in P1: phone glances (head down and back) are counted as head nods → "You are tired"',
    testType: 'S', fixes: ['T11'], ctx: { speed: SPEED.road },
    segments: [road(3000), ...repeat(6, [seg(1200, LAP), road(3800)])],
    // Distraction alarms are fine here; a fatigue advisory is not.
    expect: [{ kind: 'noAdvisory' }],
  },
]
