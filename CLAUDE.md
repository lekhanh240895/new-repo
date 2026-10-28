# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

BioMonitor DMS: a browser-only driver monitoring PWA (React 19 + Vite + MediaPipe Face Landmarker). It detects microsleep, fatigue and eyes-off-road time, all on device — no video leaves the phone, no server. Requires Node 22+. Product spec: `docs/SPEC.md`; per-failure-mode coverage: `docs/FAILURE_MODES.md`.

## Commands

```bash
npm run dev              # Vite on :5173; predev fetches the model/wasm and verifies SHA-256 vs assets.lock.json
npm run dev:phone        # HTTPS + LAN host (camera needs HTTPS on phones)
npm run check            # typecheck (tsc -b) + lint (oxlint) + vitest — what CI runs first
npm test                 # vitest run
npx vitest run src/core/fsm/session.test.ts          # single file
npx vitest run -t "name of test"                     # single test by name
npm run build            # tsc -b && vite build (also runs asset fetch/verify)
npm run smoke            # headless Chromium replay on a generated dark clip (needs `npx playwright install chromium` + a build)
npm run offline-check    # PWA install + offline reload check (CI)
```

Alert-accuracy tooling:

```bash
npm run scenarios                        # runs the 102-case library, rewrites docs/SCENARIO_REPORT.md
npm run scenarios -- --only A07          # one scenario with its alert timeline
npm run scenarios -- --update-baseline   # record new passes in src/scenarios/baseline.ts
npm run tune                             # threshold sensitivity, docs/TUNING_REPORT.md (~6 min)
npm run replay -- --clip clips/x.y4m --seconds 10 [--mode trip --expect-alerts L1,L2,L3]
npm run build && npm run clips           # real-clip judging → clips/CLIP_REPORT.md
```

Debug UI: the **Debug** tab or `/?debug`; `?delegate=cpu` forces the CPU model, `?worker=0` forces the main-thread fallback.

## Architecture

Pipeline: camera → frame loop (15 fps, 480 px) → vision engine (MediaPipe in a worker, main-thread fallback) → numeric features only (EAR, blink, MAR, head pose, gaze, light, jitter) → One Euro smoothing → quality gates → per-driver calibration → detectors → state machine → alerts (sound, voice, vibration, screen).

Layers (dependencies point inward; keep it that way):
- `src/core/` — pure TypeScript, **no DOM/React**. Config (`config.ts` holds every threshold), filters, quality gates, calibration, detectors (`detectors/pipeline.ts` is the central one: eye closure, PERCLOS and the attention buffer; `zones.ts` gaze zones; `yawn.ts`, `nod.ts`, `blinkTrend.ts` fatigue signals), and the FSM (`fsm/`, a plain reducer). Fully unit-tested with scripted signal traces.
- `src/vision/` — MediaPipe wrapper, feature math, worker protocol, engine with worker + main-thread fallback.
- `src/platform/` — device services (camera, frame loop, audio, wake lock, speed/GPS, motion sensors, battery, watchdog, notify, on-phone personal store).
- `src/app/trip/controller.ts` — the trip flow (setup check → 8 s calibration → monitoring). Every device service is **injected**, so camera loss, stalls and app switching are tested in Node with fakes (`controller.test.ts`). Preserve this injection when adding services.
- `src/app/debug/` — Debug mode; `src/app/i18n.ts` — English/Vietnamese strings (both must stay in sync).
- `src/scenarios/` + `scripts/scenarios.ts` — scripted situations run through the real detectors and FSM. `npm test` includes a **ratchet**: any scenario listed as passing in `src/scenarios/baseline.ts` must keep passing. Group G holds boundary pairs (just under / over each threshold), so moving a threshold ~15% breaks tests by design.
- `src/clips/` + `scripts/clips.ts` — judges real recorded clips (P7) with the same code as the scenarios; includes a "sign check" for head/eye direction signs.

Safety design rules from the spec (don't violate when changing alert logic): fail loud when the face/camera isn't usable; alarms never need a touch to stop; losing the face during an alarm does not cancel it; no AGPL-licensed models. Alert behavior depends on context (speed class, parked detection, turning, face-lost after head turn/drop) — the tables in README.md "Alert behavior" document the current rules and should be updated when defaults in `config.ts` change.

## Conventions and gotchas

- TypeScript strict, function components, no default exports.
- Model and wasm files are self-hosted and hash-pinned in `assets.lock.json`; nothing may load from a CDN at runtime. Production builds ship a strict CSP (generated `dist/_headers` + `<meta>` fallback for GitHub Pages) — new network access or inline scripts will break it.
- `clips/` and `replay-out/` are git-ignored; never commit videos of real people. Record clips parked/at a desk, never while driving.
- Testing alerts at a desk: untick "Use location…" on the start screen, otherwise a still phone with no speed reading counts as parked and suppresses distraction alarms (D1/D2).
- A new service worker is never applied mid-trip; the start screen offers "Update now".
- Unit tests sit next to their source as `*.test.ts`. CI also runs `npm audit --omit=dev --audit-level=high`.
- Known limits (from `CHANGELOG.md`): the head-pitch sign (`pose.headDownSign`) still needs a check on a real phone; sunglasses are not detected automatically.
