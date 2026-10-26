# BioMonitor DMS

A driver monitoring system that runs entirely in your phone's browser.
It watches for microsleep, growing fatigue and eyes-off-road time, and warns you
with calm, step-by-step alerts.

**No video ever leaves your device.** There is no server, no account and no analytics.

> ⚠️ **Status: early development (milestone M0).** The app does not use the camera yet.
> Do not rely on it while driving.

## Important limits

- **Not a certified safety device.** It does not replace rest. You stay fully responsible for driving safely.
- **Daytime / lit conditions only.** Phone front cameras have no infrared, so the app can't see your face in the dark.
- **Keep it in the foreground.** If you switch apps or take a call, monitoring pauses.

## How it works

See the full spec: [`docs/SPEC.md`](docs/SPEC.md).

- MediaPipe Face Landmarker runs in a Web Worker (coming in M1).
- Eye openness (EAR + blendshapes), PERCLOS, yawns, head pose and gaze are computed per frame.
- A pure TypeScript state machine (`src/core/fsm`) decides when to alert. It is fully unit-tested with scripted signal traces.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev        # start the dev server
npm test           # unit + golden-trace tests
npm run check      # typecheck + lint + tests
npm run build      # production build
```

### Project layout

```
src/core/      pure TypeScript: config, types, state machine (no DOM)
src/app/       React UI
src/test/      test helpers (golden traces)
docs/SPEC.md   product and technical spec
```

Code rules: TypeScript strict, function components, no default exports.

## Roadmap

| Milestone | Scope |
| --- | --- |
| **M0** ✅ | Tooling, CI, core types, config, state machine + tests |
| M1 | Camera, vision worker, signals, Debug mode, replay harness |
| M2 | Calibration, detectors, audio alerts, Wake Lock, watchdog |
| M3 | Dark Cockpit UI, offline PWA, v0.1 release |

## License

[MIT](LICENSE)
