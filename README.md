# BioMonitor DMS

A driver monitoring system that runs entirely in your phone's browser.
It watches for microsleep, growing fatigue and eyes-off-road time, and warns you
with calm, step-by-step alerts.

**No video ever leaves your device.** There is no server, no account and no analytics.

<p align="center"><img src="docs/demo.gif" alt="Start screen, Dark Cockpit monitoring with a small status dot, and the wake-up alarm in English and Vietnamese" width="260"></p>

> ⚠️ **Status: v0.1.0 preview.** The full trip flow works: setup check, per-driver
> calibration, Dark Cockpit monitoring, and microsleep / eyes-off-road / fatigue alerts,
> in English and Vietnamese, online or offline. It has been tested with replayed video,
> not yet in real driving. Do not rely on it while driving. See [CHANGELOG.md](CHANGELOG.md).

## Important limits

- **Not a certified safety device.** It does not replace rest. You stay fully responsible for driving safely.
- **Daytime / lit conditions only.** Phone front cameras have no infrared, so the app can't see your face in the dark.
- **Keep it in the foreground.** If you switch apps or take a call, monitoring pauses.

## How it works

See the full spec: [`docs/SPEC.md`](docs/SPEC.md).

```
camera → frame loop (15 fps, 480 px) → vision worker (MediaPipe Face Landmarker)
       → numbers only: EAR, blink, MAR, head pose, gaze, light, jitter
       → One Euro smoothing → quality gates
       → calibration (your own baseline) → detectors (eyes closed, off road, PERCLOS, yawns, nods)
       → state machine → alerts (sound, voice, vibration, screen)
```

A trip goes: **Start** → setup check (face, light, distance, beep) → 8 s calibration
("look at the road, blink normally") → monitoring. Alerts step up from a soft beep
(eyes closed 1 s) to a loud alarm (2 s), and stop by themselves 2 s after your eyes open.

- The model and wasm files are **self-hosted** and checked against SHA-256 hashes in `assets.lock.json`. Nothing loads from a CDN at runtime.
- Production builds carry a strict **Content-Security-Policy** (the page may only talk to itself) and work **offline** after the first trip (installable PWA).
- If the worker can't start (for example on some iOS versions), the model runs on the main thread instead.
- The state machine (`src/core/fsm`) is pure TypeScript and fully unit-tested with scripted signal traces.
- The trip controller (`src/app/trip/controller.ts`) gets every device service injected, so the whole
  flow — including camera loss, stalls and app switching — is tested in Node with fakes.
- How each of the 20 failure modes is handled and tested: [`docs/FAILURE_MODES.md`](docs/FAILURE_MODES.md).

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

Trip mode runs the whole trip flow on the clip and records the phase and alert timeline:

```bash
npm run replay -- --mode trip --clip clips/my-clip.y4m --seconds 40 --expect-alerts L1,L2,L3
```

`clips/` and `replay-out/` are git-ignored. **Never commit videos of real people.**
`npm run smoke` runs the same harness on a generated dark clip (used in CI).

### Alert accuracy scenarios

The [alert accuracy plan](docs/ALERT_ACCURACY_PLAN.md) lists 101 situations where alerts can go
wrong (intersections, mirrors, red lights, texting, squinting, …). Each one is a scripted
scenario in `src/scenarios/` that runs through the real detectors and state machine:

```bash
npm run scenarios                 # writes docs/SCENARIO_REPORT.md
npm run scenarios -- --only A07   # one scenario with its alert timeline
```

`npm test` includes a ratchet: a scenario that passed in `src/scenarios/baseline.ts` must keep
passing. After a fix, record the new passes with `npm run scenarios -- --update-baseline`.

Progress: v0.1 passed 40 scenarios; after P2 (speed context, motion sensors, gaze zones) **66**.

### Project layout

```
src/core/            pure TypeScript (no DOM): config, types, filters, quality gates,
                     calibration, detectors, state machine
src/vision/          MediaPipe wrapper, feature math, worker, engine (worker + main-thread fallback)
src/platform/        camera, frame loop, audio, wake lock, vibration, speed, watchdog
src/app/trip/        trip controller + Trip screen
src/app/debug/       Debug mode
src/scenarios/       alert-accuracy scenario library, runner and baseline
scripts/             asset fetch + hash check, replay harness, test clip generator
docs/SPEC.md         product and technical spec
docs/FAILURE_MODES.md  failure-mode coverage
```

Code rules: TypeScript strict, function components, no default exports.

## Deploy

The app is a folder of static files (`dist/`) and must be served over **HTTPS** (camera).

- **Cloudflare Pages (recommended):** build command `npm run build`, output folder `dist`.
  It reads the generated `dist/_headers`, so the strict CSP covers the page **and** the vision worker.
- **GitHub Pages:** run the *Deploy to GitHub Pages* workflow by hand (Actions tab) after
  enabling Pages (Settings → Pages → Source: GitHub Actions). GitHub Pages cannot send headers,
  so only the page gets the CSP (via a `<meta>` tag), not the worker.

New versions are never applied in the middle of a trip: the start screen offers "Update now".

## Roadmap

| Milestone | Scope |
| --- | --- |
| **M0** ✅ | Tooling, CI, core types, config, state machine + tests |
| **M1** ✅ | Camera, vision worker + fallback, signals, quality gates, Debug mode, replay harness |
| **M2** ✅ | Calibration, detectors, alerts (sound, voice, vibration), Wake Lock, watchdog, trip controller |
| **M3** ✅ | Dark Cockpit UI, onboarding, Vietnamese, offline PWA, CSP, battery + pause notification — **v0.1.0** |
| **P1–P2** ✅ | Alert accuracy: 102-case scenario library + ratchet; speed context, motion sensors, gaze zones, hysteresis |
| Next | P3 attention buffer + scanning · P4 eye-closure robustness · P5 alarm behavior · real-device checks |

## License

[MIT](LICENSE). MediaPipe is Apache-2.0.
