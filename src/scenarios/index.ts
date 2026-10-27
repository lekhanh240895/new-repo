/** All scenarios from docs/ALERT_ACCURACY_PLAN.md, in plan order, plus the group G boundary pairs (P6). */
import { GROUP_A } from './library/a-driving-looks.ts'
import { GROUP_B } from './library/b-real-distraction.ts'
import { GROUP_C } from './library/c-false-closed.ts'
import { GROUP_D } from './library/d-missed-microsleep.ts'
import { GROUP_E } from './library/e-fatigue.ts'
import { GROUP_F } from './library/f-alarm-behavior.ts'
import { GROUP_G } from './library/g-boundaries.ts'
import type { Scenario } from './types.ts'

export const GROUPS: Readonly<Record<string, { title: string; scenarios: readonly Scenario[] }>> = {
  A: { title: 'Looking away for driving (no distraction alarm)', scenarios: GROUP_A },
  B: { title: 'Real distraction (must alert)', scenarios: GROUP_B },
  C: { title: 'False "eyes closed" (no microsleep alarm)', scenarios: GROUP_C },
  D: { title: 'Microsleep (must alert)', scenarios: GROUP_D },
  E: { title: 'Fatigue advisory', scenarios: GROUP_E },
  F: { title: 'Alarm behavior and sensors', scenarios: GROUP_F },
  G: { title: 'Boundary pairs (just under / just over a threshold)', scenarios: GROUP_G },
}

export const SCENARIOS: readonly Scenario[] = Object.values(GROUPS).flatMap((g) => g.scenarios)

export { runScenario, type ScenarioResult, type ScenarioStatus } from './runner.ts'
