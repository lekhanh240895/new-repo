# BioMonitor DMS

A driver monitoring system that runs entirely in your phone's browser.
It watches for microsleep, growing fatigue and eyes-off-road time, and warns you
with calm, step-by-step alerts.

**No video ever leaves your device.** There is no server, no account and no analytics.

> ⚠️ **Status: early development (milestone M1).** The camera pipeline and Debug mode work.
> Alerts are not connected to the camera yet. Do not rely on it while driving.

## Important limits

- **Not a certified safety device.** It does not replace rest. You stay fully responsible for driving safely.
- **Daytime / lit conditions only.** Phone front cameras have no infrared, so the app can't see your face in the dark.
- **Keep it in the foreground.** If you switch apps or take a call, monitoring pauses.

## How it works

See the full spec: [`docs/SPEC.md`](docs/SPEC.md).

```
camera → frame loop (15 fps, 480 px) → vision worker (MediaPipe Face Landmarker)
       → numbers only: EAR, blink, MAR, head pose, gaze, light, jitter
       → One Euro smoothing → quality gates → state machine (alerts)
```

- The model and wasm files are **self-hosted** and checked against SHA-256 hashes in `assets.lock.json`. Nothing loads from a CDN at runtime.
- If the worker can't start (for example on some iOS versions), the model runs on the main thread instead.
- The state machine (`src/core/fsm`) is pure TypeScript and fully unit-tested with scripted signal traces.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173 — fetches and verifies model files first
npm test           # unit + golden-trace tests
npm run check      # typecheck + lint + tests
npm run build      # production build
```

### Debug mode

Open the **Debug** tab (or `http://localhost:5173/?debug`) and tap **Start camera**.
You get the camera preview with landmarks, live readouts and charts for EAR, blink,
mouth, head pose, gaze and performance.

Useful URL switches: `?delegate=cpu` forces the CPU model, `?worker=0` forces the main-thread fallback.

Use Debug mode parked or at a desk only.

### Test on a phone

Phones only allow the camera on HTTPS. Run:

```bash
npm run dev:phone
```

Open the `Network: https://…` address on a phone on the same Wi-Fi. Accept the
self-signed certificate warning (development only).

### Replay a video (for tuning)

The replay harness plays a video as a fake camera in Chromium, runs the real pipeline,
and saves every frame's numbers as JSON:

```bash
npx playwright install chromium     # once
npm run build
ffmpeg -i my-clip.mp4 -vf scale=640:480 -r 30 -pix_fmt yuv420p clips/my-clip.y4m
npm run replay -- --clip clips/my-clip.y4m --seconds 10
# → replay-out/my-clip.json
```

`clips/` and `replay-out/` are git-ignored. **Never commit videos of real people.**
`npm run smoke` runs the same harness on a generated dark clip (used in CI).

### Project layout

```
src/core/       pure TypeScript: config, types, filters, quality gates, state machine (no DOM)
src/vision/     MediaPipe wrapper, feature math, worker, engine (worker + main-thread fallback)
src/platform/   camera, frame loop
src/app/        React UI (Trip demo, Debug mode)
scripts/        asset fetch + hash check, replay harness, test clip generator
docs/SPEC.md    product and technical spec
```

Code rules: TypeScript strict, function components, no default exports.

## Roadmap

| Milestone | Scope |
| --- | --- |
| **M0** ✅ | Tooling, CI, core types, config, state machine + tests |
| **M1** ✅ | Camera, vision worker + fallback, signals, quality gates, Debug mode, replay harness |
| M2 | Calibration, detectors, audio alerts, Wake Lock, watchdog; connect the camera to the state machine |
| M3 | Dark Cockpit UI, offline PWA, v0.1 release |

## License

[MIT](LICENSE). MediaPipe is Apache-2.0.
