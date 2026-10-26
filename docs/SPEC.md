# BioMonitor DMS — Product & Technical Spec (v1)

> A driver monitoring system that runs fully inside a mobile browser.
> It watches the driver's face through the phone's front camera and warns them
> about microsleep, growing fatigue and eyes-off-road time.
> No video ever leaves the device.

| Field | Value |
| --- | --- |
| Status | Draft v1.0 — ready for review |
| Date | 2026-10-26 |
| Owner | Khanh Le |
| License (planned) | MIT (code). Models must be Apache-2.0 / MIT compatible. |
| Language of this doc | English (Vietnamese UI strings are planned) |

---

## 0. Summary of key decisions

These choices shape everything below. Each one has a reason in the section noted.

| # | Decision | Why | Section |
| --- | --- | --- | --- |
| D1 | **v1 = drowsiness + eyes-off-road only.** Phone-object detection, hand tracking and rPPG (heart rate) are **not** in v1. | Keep the safety path small, fast and testable. | §2, §17 |
| D2 | **Target Android Chrome first.** iOS Safari is "best effort" in v1. | Wake Lock, vibration, GPU-in-worker and background behavior are weaker on iOS. | §5 |
| D3 | **Daytime and lit conditions only in v1, stated clearly.** | Phone front cameras have no infrared. In the dark, the face can't be seen. | §4, §12 |
| D4 | **The system must "fail loud".** When it can't see the driver, it tells them it is not protecting them. It never stays silent. | Silent failure gives false trust. That is worse than no app. | §4 |
| D5 | **No touch is required to stop an alarm while driving.** The alarm stops when eyes are open and the head is upright. | Asking a drowsy driver to touch a phone is a new danger. | §11 |
| D6 | **Losing the face during an alarm does not cancel the alarm.** | A driver who slumps forward leaves the camera view. That is the worst case, not a "pause". | §10 |
| D7 | Use MediaPipe **Face Landmarker** outputs directly: 478 landmarks + 52 blendshapes + facial transformation matrix. **No custom SolvePnP.** | The matrix already gives head pose. Blendshapes give a second, independent blink signal. | §8 |
| D8 | Safety logic lives in a **pure TypeScript core** (no DOM, no React). The FSM is a plain reducer. | Easy to unit-test with fake signals. The same code runs in replay tests. | §6, §15 |
| D9 | **Never use AGPL models** (for example Ultralytics YOLOv8) in this repo. | AGPL conflicts with an MIT core plus a closed SaaS tier. Use MediaPipe / Apache-2.0 models. | §17, §18 |
| D10 | The enterprise dashboard is **out of scope** for this spec. It needs its own privacy and legal review. | Sending driver-state data to an employer is processing of sensitive data. | §14, §17 |

---

## 1. Problem

- Microsleep (an unplanned "sleep" of 1 to a few seconds) and phone distraction are major causes of road crashes. New drivers and long night trips carry the most risk.
- Current options have problems:
  - Built-in DMS only comes with new, expensive cars.
  - Wearables cost money and feel uncomfortable.
  - Cloud camera systems send video off the device, which is a privacy problem.
- Most open-source drowsiness projects are Python desktop scripts with a fixed EAR threshold. They give many false alarms in a real cabin. A few web ones exist (for example `LukeConran/ready-alert`, `srujan-s22/driver-drowsiness-detector`), but none clearly combines calibration, temporal logic, fail-safe states and a calm alert design in a mobile PWA.

## 2. Goals and non-goals

### 2.1 Goals (v1)

1. Detect **microsleep** (eyes closed ≥ 1.0 s) and warn within the alert ladder in §11.
2. Detect **growing fatigue** (PERCLOS, slow blinks, yawns, head nods) and suggest a break *before* microsleep happens.
3. Detect **eyes-off-road** (head or gaze away from the road ≥ 2.0 s).
4. Run **100% on device** as an installable PWA that works offline after first load.
5. Never become a distraction itself ("Dark Cockpit" UI).
6. Tell the driver clearly whenever monitoring is **not** working.

### 2.2 Non-goals (v1)

- Medical claims of any kind. No heart rate, HRV, stress or "health" readings in v1.
- Detecting the phone as an object, or hands off the wheel.
- Night driving without external IR lighting.
- Any server, account, cloud sync or fleet dashboard.
- Certification under any automotive standard. This is **not** a certified safety device.

## 3. Users and main use cases

| User | Use case |
| --- | --- |
| Private driver (main v1 user) | Mounts their phone, taps "Start trip", drives. Gets warned about microsleep and long glances away. |
| Developer / researcher | Opens Debug mode while parked. Sees landmarks and live signal charts. Replays recorded videos. |
| Driving school (later) | Uses trip summaries to coach students. Not in v1. |
| Fleet manager (later, paid) | Sees fleet-level safety scores. Out of scope here (§17). |

### 3.1 Main flow

1. Open the PWA → first-run screen: safety disclaimer + mounting guide.
2. Tap **Start trip** (this one tap also unlocks audio, Wake Lock and camera).
3. **Setup check** (about 10 s): camera works, face found, light OK, volume test tone played.
4. **Calibration** (about 8 s): look at the road, blink normally.
5. **Monitoring** in Dark Cockpit mode: black screen, one small slow-pulsing green dot.
6. Alerts appear only when needed (§11).
7. Tap **End trip** when parked → short local summary (count of events, longest closure, trip time).

## 4. Safety principles

1. **Fail loud, not silent.** If the system can't see the driver for more than 10 s, it plays a calm "monitoring off" chime and shows a grey dot. It repeats this every 60 s while the problem lasts.
2. **Worst-case wins.** If signals conflict (for example the face is lost while the eyes were closing), assume the more dangerous case.
3. **No new distraction.** No camera preview, no moving graphics, and no text to read while monitoring.
4. **No startle.** Alerts escalate in steps (§11). Only a real microsleep reaches the loud alarm.
5. **Honest limits.** The app shows its limits on first run and in the README: no night use without IR light, no protection in the background, not a certified device.
6. **Test safely.** Never test drowsiness while really driving. Use a parked car, a passenger acting, or recorded video (§15).

## 5. Platform support

| Feature | Android Chrome (v1 target) | iOS Safari 17+ (best effort) | Plan if missing |
| --- | --- | --- | --- |
| Camera (`getUserMedia`) | Yes | Yes | — |
| Screen Wake Lock | Yes | Yes (16.4+; check installed-PWA behavior on test devices) | Show "Keep screen on" tip; block start if no lock and no tip confirmed |
| Vibration API | Yes | **No** | Use visual + audio only |
| Web Worker + OffscreenCanvas + WebGL/GPU in worker | Yes | Partial; test per version | **Fallback: run inference on the main thread** |
| Audio in background | Partly | Usually suspended | Warn on hide (§12, F10) |
| Geolocation speed | Yes | Yes | Optional; assume "moving" if not given |
| Battery Status API | Yes | No | Skip warning |

Minimum hardware for "supported": a phone that keeps ≥ 12 fps inference after 30 min of use. The device list is kept in `docs/DEVICES.md` (to be created).

## 6. Architecture

### 6.1 Threads

```
┌──────────────────────── Main thread ────────────────────────┐
│ React UI (Dark Cockpit / Setup / Debug)                     │
│ Camera capture → createImageBitmap(video, resize 480×360)   │
│ Core: SignalProcessor → Detectors → FSM (pure TS reducer)   │
│ Platform: AudioEngine, WakeLock, Visibility, Haptics, Speed │
│ Watchdog (heartbeat from worker)                            │
└───────────────┬──────────────────────────▲──────────────────┘
                │ ImageBitmap (transfer)   │ FrameResult (numbers only)
┌───────────────▼──────────────────────────┴──────────────────┐
│ Vision worker                                               │
│ MediaPipe FaceLandmarker (VIDEO mode, GPU → CPU fallback)   │
│ Feature extraction: EAR, MAR, blendshapes, pose, gaze, luma │
└─────────────────────────────────────────────────────────────┘
```

- The core (signals, filters, calibration, detectors, FSM) runs on the main thread. It is cheap: about 20 numbers per frame.
- Only numbers cross from the worker to the main thread. Frames never leave the worker except in Debug mode.
- If worker init fails (for example no GPU in a worker on iOS), the same vision module runs on the main thread. The UI shows "compatibility mode".

### 6.2 Folder layout

```
src/
  core/                 # pure TS, no DOM — fully unit-tested
    config.ts           # all thresholds (§10) in one typed object
    types.ts            # FrameResult, Signals, Events, State
    filters/oneEuro.ts
    signals/            # normalize, fuse, quality gates
    calibration/        # baseline learning + quantile tracker
    detectors/          # closure, perclos, yawn, nod, offRoad
    fsm/                # reducer, states, transitions
  vision/
    worker.ts           # worker entry
    faceLandmarker.ts   # MediaPipe wrapper (GPU/CPU)
    features.ts         # EAR, MAR, pose from matrix, gaze, luma
  platform/
    audio.ts  wakeLock.ts  visibility.ts  haptics.ts  camera.ts  speed.ts  watchdog.ts
  app/                  # React components (function components, named exports)
    screens/  hud/  debug/
  test/
    fixtures/  replay/
public/models/          # self-hosted .task model + wasm, version-pinned
```

Code rules: TypeScript `strict: true`, function components only, **no default exports**, every async platform call wrapped with error handling that maps to a sensor or fault state.

### 6.3 Data contract (worker → main)

```ts
export interface FrameResult {
  t: number;                    // capture timestamp, ms (performance.now)
  inferMs: number;              // time spent in the model
  faceFound: boolean;
  quality: {
    faceLuma: number;           // mean luma (0–255) inside face box
    faceAreaRatio: number;      // face box area / frame area
    landmarkJitter: number;     // frame-to-frame motion of stable points (nose bridge)
  };
  eye?: { earL: number; earR: number; blinkL: number; blinkR: number }; // blink = blendshape 0–1
  mouth?: { mar: number; jawOpen: number };
  pose?: { pitchDeg: number; yawDeg: number; rollDeg: number };        // from transformation matrix
  gaze?: { x: number; y: number };   // iris offset in eye box, −1..1
}
```

## 7. Tech stack

| Area | Choice | Note |
| --- | --- | --- |
| Build | Vite + React + TypeScript (strict) | |
| Styling | TailwindCSS | |
| Vision | `@mediapipe/tasks-vision` FaceLandmarker, version pinned | Model `face_landmarker.task` (float16, about 4 MB) and wasm self-hosted in `public/models/` |
| State | Pure TS reducer in `core/fsm` + tiny React hook (`useSyncExternalStore`) | No XState or Zustand needed in v1 |
| PWA | `vite-plugin-pwa` (Workbox), precache models and wasm | Works offline after first load |
| Tests | Vitest (unit), Playwright (E2E + replay with fake camera) | |
| CI | GitHub Actions: typecheck, lint, unit, build, model hash check | |

## 8. Signals

All signals are computed per frame. Every signal carries a `valid` flag. Detectors ignore invalid frames. Invalid frames also count toward the "valid data" ratio of each window.

### 8.1 Eye openness (main signal)

1. **EAR** per eye, from 6 landmarks:
   `EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2‖p1−p4‖)`
   - Subject's left eye: 362, 385, 387, 263, 373, 380. Subject's right eye: 33, 160, 158, 133, 153, 144. "Left/right" follow MediaPipe naming (`FACE_LANDMARKS_LEFT_EYE`), which matches blendshape `eyeBlinkLeft`. A unit test checks these against the MediaPipe connection lists.
2. **Normalize** with the driver's baseline (§9):
   `open = clamp((EAR − EAR_closed) / (EAR_open − EAR_closed), 0, 1)`
3. **Fuse** with the blendshape: `openFused = 0.6·open + 0.4·(1 − eyeBlink)`. Do this per eye, then take the mean of both eyes.
   - If one eye is invalid (|yaw| > 25°, the far eye is hidden), use the near eye only.
4. **Eye closed** = `openFused < 0.30`. This matches "≥ 70% closed", the P70 rule used by PERCLOS.
5. **Note on mirroring:** blendshape `Left`/`Right` refer to the subject's face. Do not mirror frames before inference.

### 8.2 Mouth

- `MAR` from landmarks 13/14 (inner lips, vertical) and 78/308 (corners, horizontal).
- Fused with blendshape `jawOpen`. Normalized against the calibration baseline.

### 8.3 Head pose

- Pitch, yaw and roll come from `facialTransformationMatrixes[0]` (rotation part, converted to Euler angles).
- All angles are **relative to the calibration baseline**. This handles a phone mounted to the side.

### 8.4 Gaze (coarse)

- Iris center (473 = subject's left, 468 = subject's right) relative to the eye corners and lids gives x/y in −1..1.
- Used only to tell "looking down while the head is straight" from "looking ahead". It is coarse and is not used for exact gaze points.

### 8.5 Filtering

- Apply the **One Euro filter** to the **derived signals** (`openFused`, `mar`, pitch/yaw/roll, gaze), not to all 478 points. This is cheaper, and blinks stay sharp.
- Start values: `minCutoff = 1.0 Hz`, `beta = 0.007`, `dCutoff = 1.0 Hz`. Tune with replay data.

### 8.6 Quality gates (when a frame is invalid)

| Gate | Rule (default) | Resulting sensor state |
| --- | --- | --- |
| Face lost, short | `faceFound = false` for < 1.5 s (hand, cup, quick turn) | `OCCLUDED` |
| Too dark / too bright | `faceLuma < 40` or `> 220` for ≥ 1.0 s | `LOW_VISIBILITY` |
| Face too small | `faceAreaRatio < 0.04` for ≥ 1.0 s | `LOW_VISIBILITY` (prompt: move the phone closer) |
| Heavy shake | `landmarkJitter` > 3× calibration value for > 0.5 s | Frames invalid; no state change if < 2 s |
| Eye region bad | Both eyes invalid but face found (sunglasses, glare) | `EYES_HIDDEN` → degraded mode (§10.4) |
| Face lost, long | `faceFound = false` for ≥ 1.5 s | `NO_FACE` |
| Slow frames | fps < 8 for > 3 s | `DEGRADED` (notice + lower resolution) |

## 9. Calibration

- **Duration:** 8 s, guided by short voice or tone prompts. "Look at the road" → "Blink normally".
- **Learns:** `EAR_open` (median of open frames), `EAR_closed` (from blink minimums; fallback `EAR_open × 0.35`), MAR baseline, pose baseline (median pitch/yaw/roll), jitter baseline, mean face luma.
- **Rejected if:**
  - fewer than 2 blinks were seen,
  - pose spread is more than 8° (driver moving),
  - fewer than 70% of frames are valid.

  If rejected, retry up to 3 times, then let the driver continue with population defaults and a "less accurate" notice.
- **Online update:** a slow quantile tracker updates `EAR_open` (90th percentile over the last 5 min of valid frames). It only updates while no alert is active and PERCLOS is low. Max drift: ±15% from the calibrated value. This stops the baseline from "learning" drowsiness as normal.
- **Re-calibrate prompt:** when the pose baseline shifts by more than 15° for more than 30 s (the phone mount moved).

## 10. Detection rules

All numbers live in `core/config.ts`. They are **starting defaults** to tune with data (§15).

### 10.1 Eye closure and microsleep

| Event | Rule |
| --- | --- |
| Blink | Closed for 50–400 ms. Counted for stats only. |
| Slow blink | Closed for 400–1000 ms. Counted as a fatigue sign. |
| Microsleep L1 | Closed continuously ≥ **1.0 s** |
| Microsleep L2 | Closed continuously ≥ **1.5 s** |
| Microsleep L3 | Closed continuously ≥ **2.0 s** |

### 10.2 Fatigue (slow build-up)

| Signal | Window | Advisory | Strong advisory |
| --- | --- | --- | --- |
| PERCLOS (P70) | 60 s sliding, needs ≥ 70% valid frames | > 15% | > 25% |
| Slow blinks | 5 min | ≥ 6 | ≥ 12 |
| Yawns | 10 min | ≥ 3 | ≥ 5 |
| Head nods | 5 min | ≥ 1 | ≥ 2 |

- **Yawn:** mouth fused openness > 0.6 (normalized) held ≥ 1.2 s, **and** the open phase is not a fast cycle. Speech or singing shows ≥ 2 open/close cycles per second in the last 2 s; that is rejected.
- **Head nod:** pitch drops ≥ 15° below baseline in < 0.6 s, then recovers within 3 s.
- The fatigue score combines these into `NONE / ADVISORY / STRONG`. Advisory gives a calm voice prompt to take a break. Strong also lowers the microsleep thresholds by 0.2 s for the next 15 min.

### 10.3 Eyes off road

| Event | Rule |
| --- | --- |
| Off-road frame | |yaw| > 30°, or pitch < −20° (looking down), or head straight but gaze.y < −0.5 (eyes down) |
| Mirror / shoulder check (ignore) | Off-road < 2.0 s |
| Distraction D1 | Off-road continuously ≥ **2.0 s** |
| Distraction D2 | Off-road continuously ≥ **3.5 s**, or total off-road > 6 s within the last 30 s |

Note: "eyes down ≥ 2 s" is labeled "eyes off road", **not** "phone use". It can also be the speedometer or the radio. We don't claim phone detection in v1.

### 10.4 Degraded mode (`EYES_HIDDEN`: sunglasses, glare)

- Eye rules are off. Head-nod, head-drop and yawn rules stay on.
- **Head drop:** pitch < −15° below baseline for ≥ 1.0 s → treated like microsleep L1. ≥ 1.5 s → L2.
- The HUD dot turns **amber** (meaning "limited monitoring"). One spoken notice: "Eyes not visible. Limited monitoring."

### 10.5 Face lost during danger (fail-safe)

- If an alert at L1 or higher is active, or pitch was falling fast, and the face is then lost → **keep escalating** as if the eyes are closed.
- If the face is lost with no prior danger sign → `NO_FACE` (fail loud after 10 s, §4).

### 10.6 Arming by speed (optional)

- With location permission: alerts are armed only when speed > 10 km/h. Below that, events are logged but not alarmed (no alarm at a red light when you rub your eyes).
- Without permission: always armed.

## 11. Alert design

| Level | Trigger | Visual | Audio | Haptic (Android) |
| --- | --- | --- | --- | --- |
| Advisory | Fatigue ADVISORY | Dot slowly changes green → amber | Short calm voice: "Signs of fatigue. Plan a break." Max once per 10 min | none |
| Strong advisory | Fatigue STRONG | Amber dot, slow pulse | Voice: "You are tired. Please stop at a safe place." Max once per 5 min | 1 short pulse |
| D1 / L1 | Distraction D1 or microsleep L1 | Amber screen-edge pulse | 2 short soft tones (≈ 880 Hz, gain 0.3) | 1 pulse |
| D2 / L2 | Distraction D2 or microsleep L2 | Full amber flash | Rising chirp 600 → 1400 Hz, gain ramps 0.4 → 0.8 over 1 s, repeats | 3 pulses |
| L3 | Microsleep L3 or face lost in danger | Full red flash (≤ 3 Hz, to avoid photosensitive seizure risk) | Loud alternating 1000/1500 Hz siren at gain 1.0 | Long pattern |

- **Stop rule:** an alarm stops when `openFused > 0.6` **and** pose is within ±15° of baseline for **2.0 s continuous**. No touch is needed. A large "I'm awake" button also works, but it is never required.
- **After L2/L3:** a voice prompt says "Please take a break". The fatigue level goes to at least ADVISORY for 15 min.
- **Gain is relative.** A web page can't set absolute dB. The setup check plays a test tone and asks the driver to raise the volume if it is low. If Android exposes low media volume, the app shows a warning.
- **Sound source:** Web Audio `OscillatorNode` only (no audio files, no network). The `AudioContext` is created and resumed on the **Start trip** tap. A silent node keeps it alive.

## 12. Failure-mode matrix (20 cases)

| # | Failure | Detection | Response |
| --- | --- | --- | --- |
| F1 | Backlight / glare | Face luma > 220 | `LOW_VISIBILITY`; prompt "Glare — adjust the mount"; fail loud after 10 s |
| F2 | Night / tunnel | Luma < 40 or no face | `LOW_VISIBILITY` / `NO_FACE`; "monitoring off" chime; README states the night limit |
| F3 | Sunglasses | Eyes invalid, face found | Degraded mode (§10.4) |
| F4 | Narrow or single-lid eyes, squinting | — | Per-driver calibration + fused blendshape (§8.1, §9) |
| F5 | Road vibration | Jitter gate | One Euro filter on signals; shaky frames invalid (§8.6) |
| F6 | Heat / slow device | fps + `inferMs` | Lower resolution (480 → 320 px wide), target 12 fps, `DEGRADED` notice if < 8 fps |
| F7 | Screen sleeps | Wake Lock released | Request again on `visibilitychange`/`release`; warn if it fails |
| F8 | Audio blocked by autoplay | `AudioContext.state` | Create and resume on the Start tap; check before every alert; show a visual alert if audio fails |
| F9 | GPU context lost | Worker error / `webglcontextlost` | Pause, re-init in 1 s, max 3 tries, then CPU fallback, then `FAULT` |
| F10 | App hidden (call, tab switch) | `visibilitychange` → hidden | Play a short "monitoring paused" tone at once; show a notification if allowed; resume and re-check on return |
| F11 | Talking or singing seen as yawning | Mouth cycle rate | Reject fast cycles (§10.2) |
| F12 | Hand on face, drinking | Occlusion gate | `OCCLUDED` up to 1.5 s, then `NO_FACE` rules |
| F13 | Mirror / blind-spot check | Off-road timer | Ignore < 2.0 s (§10.3) |
| F14 | The app itself distracts | — | Dark Cockpit; no preview; Debug mode only when parked |
| F15 | Startle from a sudden alarm | — | Alert ladder (§11) |
| F16 | Phone mount moves or falls | Pose baseline shift > 15° for 30 s, or no face + big motion | Prompt to re-calibrate; fail loud |
| F17 | Passenger face in view | More than 1 face | Track the face nearest the calibrated position and size; ignore others |
| F18 | Low battery / overheating | Battery API (Android), fps drop | Warn at 15% if not charging; README: keep the phone on a charger |
| F19 | Camera taken or permission revoked | Track `ended` / `mute` events | `FAULT` + "monitoring off" chime; try to reopen once |
| F20 | Worker or model stalls | Watchdog: no `FrameResult` in 1.0 s | Restart the worker; if it still fails after 3 s → `FAULT` with chime |

## 13. State machine

Two parallel parts. This keeps "can we see?" separate from "is the driver OK?".

### 13.1 Session states

`IDLE → PERMISSIONS → LOADING → SETUP_CHECK → CALIBRATING → MONITORING → SUMMARY`
Also `SUSPENDED` (page hidden) and `FAULT`, both reachable from any running state.

### 13.2 Inside MONITORING

**Sensor state:** `OK | DEGRADED | EYES_HIDDEN | OCCLUDED | NO_FACE | LOW_VISIBILITY`

**Alert state** (highest priority wins):

```
L3 > L2 > D2 > L1 > D1 > STRONG_ADVISORY > ADVISORY > NONE
```

### 13.3 Transition table (main rows)

| From | Event | To | Action |
| --- | --- | --- | --- |
| any alert | closure ≥ 1.0 / 1.5 / 2.0 s | L1 / L2 / L3 | start the level's alert |
| NONE | off-road ≥ 2.0 s | D1 | soft alert |
| D1 | off-road ≥ 3.5 s, or 6 s within 30 s | D2 | escalate |
| L1–L3, D1–D2 | recovery 2.0 s (§11) | NONE or the current fatigue level | stop the alarm; L2/L3 → break prompt |
| L1+ | face lost | same, keep the timer running | fail-safe (§10.5) |
| NONE | sensor ≠ OK for 10 s | NONE + "monitoring off" notice | chime every 60 s |
| any | page hidden | SUSPENDED | pause tone + notification |
| any | watchdog / camera ended | FAULT | chime, recovery attempt |

The reducer is pure: `(state, event, now) → { state, effects[] }`. Effects (play sound, vibrate, speak) are run by the platform layer. Tests check the effects list.

## 14. Privacy and security

### 14.1 Promises (written in the README and enforced in code)

- **No image or video leaves the device. Ever.** Frames live only in memory.
- No account, no analytics, no third-party scripts or fonts.
- **CSP:** `default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'`. Test this in CI with a header check.
- Trip logs hold numbers and events only. They are stored in IndexedDB, can be deleted with one tap, and are auto-deleted after 30 days.
- The Debug "record clip" feature saves to the device only, and only after an explicit tap.

### 14.2 Security risks to manage

| Risk | Control |
| --- | --- |
| Tampered model or wasm (supply chain) | Self-host in `public/models/`; pin the npm version; store SHA-256 hashes in `models.lock.json`; CI fails on a mismatch |
| Malicious dependency | Lockfile, `npm audit` in CI, Dependabot, few dependencies |
| Camera abuse | Camera starts only after the Start tap; stops on End trip; the OS indicator stays on |
| HTTPS | Required for the camera; host on GitHub Pages / Cloudflare Pages with HSTS |

### 14.3 Legal notes

- Do **not** claim "HIPAA compliant". HIPAA applies to US healthcare entities, and this app is not one.
- Local-only processing is a strong privacy design. It does **not** remove legal duties once data is sent to someone else.
- Any future employer or fleet feature processes **sensitive personal data**:
  - **Vietnam:** biometric and health-type data under the Personal Data Protection Law (Law 91/2025/QH15, in force since 1 Jan 2026; guided by Decree 356/2025).
  - **EU:** GDPR Art. 9.
  - It needs explicit consent, a DPIA and labor-law review **before** it is built.
- A first-run disclaimer must be accepted. It says the app does not replace rest, is not a certified safety device, and the driver stays fully responsible.

## 15. Testing and validation

### 15.1 Levels

| Level | What | Tool |
| --- | --- | --- |
| Unit | Filters, EAR/MAR math, landmark indices, calibration, every detector, every FSM row | Vitest |
| Golden traces | Scripted signal sequences (for example a "2.1 s closure then recovery") → expected effects list | Vitest |
| Replay | Real videos fed as a fake camera: Chromium `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=clip.y4m`. Output JSON traces are compared with labels. | Playwright |
| Device | Real phones, mounted, parked car, day / dusk / backlight, 30-min heat soak | Manual checklist |
| Field (alert drivers) | Normal daytime trips, to measure false alarms only | Trip logs |

### 15.2 Data

- Public datasets for offline evaluation (check each license; **never commit them**): YawDD, UTA-RLDD, NTHU-DDD, MR-NIRP Car.
- Our own clips: scripted actions in a parked car (long closures, nods, mirror checks, talking, sunglasses, drinking), recorded with consent and stored outside the repo.

### 15.3 Release targets for v1.0 (to confirm after the first data)

| Metric | Target |
| --- | --- |
| Scripted ≥ 2.0 s closures detected (L3 reached) | ≥ 95% |
| Delay from rule time to sound | ≤ 150 ms (p95) |
| False L2+ alarms in alert daytime driving | ≤ 1 per 4 hours |
| False D1 from mirror checks | ≤ 1 per hour |
| Inference rate after 30 min on reference Android | ≥ 12 fps |
| Battery use (screen black, min brightness, not charging) | Measure and publish; target ≤ 15% per hour |

## 16. UI screens

1. **Welcome / disclaimer** (first run only).
2. **Mount guide:** phone at the center vent or on the dash, camera at eye level, face fills about 1/4 of the frame, not behind the steering wheel.
3. **Setup check:** a live preview is shown **here only**, plus checkmarks for face, light, volume and Wake Lock.
4. **Calibration:** big simple prompts, progress ring.
5. **Dark Cockpit HUD:** black screen, one 12 px dot in a corner.
   - Green = OK, amber = limited, grey = not monitoring, red = alarm.
   - A tiny "End trip" button needs a long press (no accidental taps).
6. **Alert overlays** (§11).
7. **Trip summary:** event counts, longest closure, suggestion text. Numbers only.
8. **Debug mode** (Settings → Developer): landmark overlay and live EAR/MAR/PERCLOS/pose charts. Shows a "Parked only" banner. If speed is known and > 5 km/h, it switches itself off.

Accessibility: alerts never rely on color alone (sound + pattern too), and flashing stays ≤ 3 Hz.

## 17. Roadmap

| Milestone | Scope | Exit check |
| --- | --- | --- |
| **M0** — week 1 | Repo setup (Vite, TS strict, lint, Vitest, CI), `core/types`, `config`, FSM reducer + golden tests with fake signals | CI green; all FSM rows tested |
| **M1** — weeks 2–3 | Camera + worker + FaceLandmarker (GPU/CPU + main-thread fallback), features, filters, quality gates, Debug mode, replay harness | Debug charts work on 2 Android phones; replay produces traces |
| **M2** — week 4 | Calibration, all detectors, AudioEngine, Wake Lock, visibility, watchdog, speed arming | All 20 failure modes have a test or a manual check |
| **M3** — week 5 | Dark Cockpit UI, setup check, PWA offline, CSP, model hashes, README with GIF, parked-car tests | **v0.1 public release** |
| v0.2 | Tune thresholds from replay + field data, trip summary, Vietnamese/English UI | Meets §15.3 targets |
| v0.3 (experimental) | Phone-object detection with MediaPipe Object Detector (EfficientDet-Lite, Apache-2.0, COCO "cell phone" class), every N frames, flag off by default | Precision measured on our clips |
| Research track | rPPG (POS algorithm) in **parked / desk mode only**, never used for alerts | Error vs a chest strap published honestly |
| Later | Pro (B2C) and Fleet (B2B) tiers | Separate spec + privacy/legal review |

### 17.1 Status notes

- **M0 done.** State machine + golden-trace tests.
- **M1 done** (verified in headless Chromium with the replay harness): worker and main-thread backends, GPU and CPU delegates, quality gates (including "no face + dark frame → LOW_VISIBILITY"), Debug mode, replay harness, CI smoke test.
- **Carried into M2:**
  - Confirm the **pitch sign** on a real device (nod down in Debug mode; pitch should go negative). A flat test photo cannot nod.
  - Pick GPU or CPU with a short start-up benchmark. In headless Chromium without a GPU, the emulated GPU was much slower than CPU (~360 ms vs ~40 ms per frame).
  - `EYES_HIDDEN` (sunglasses) detection needs real recordings first.
  - Choose the driver face by calibrated position, not just "largest face" (F17).
  - Watchdog (F20) and adaptive resolution (F6).

## 18. Review of claims in the original brief

Things to fix in the README, pitch and docs so the project stays credible.

| Claim | Status | Use instead |
| --- | --- | --- |
| "Latency only 5–8 ms" | Not measured; on mid-range phones expect tens of ms per frame | "Measured on device X: p50 / p95 ms" |
| "rPPG accuracy near medical devices" (MAE 1–2 bpm, ICC 0.96) | These come from controlled lab settings. In cars, published error rises sharply: one study reports heart-rate RMSE > 9 bpm on car datasets because of motion and light changes. | rPPG is research only, parked only, not for safety decisions |
| "HIPAA/GDPR by design" | HIPAA does not apply; GDPR is not automatic | "Privacy by design: video never leaves your device" |
| "Calibration removes false alarms completely" | It reduces them, not to zero | "Reduces false alarms; see measured rate" |
| "Eyes down ≥ 2 s = phone use" | Can also be the dashboard | "Eyes off road" |
| "Tap 'I'm awake' to stop the alarm" (L3) | Unsafe while driving | Auto-stop on eyes open + head up (§11) |
| "YOLOv8-nano for phone detection" | AGPL-3.0 license (enterprise license sold separately) | MediaPipe Object Detector (Apache-2.0) |
| "MediaPipe Hands for hands off the wheel" | A phone camera rarely sees the wheel | Dropped from v1 |
| "detectionConfidence < 0.45 per frame" | Face Landmarker does not return a per-frame score | Quality gates (§8.6) |
| "Night accuracy 93% → 87%" | Source not found | Don't cite; state "not for night use" |

## 19. Open questions

1. Is Android-first acceptable, or must iPhone be fully supported at v0.1?
2. Is "daytime only" acceptable for v0.1, or should we plan support for an external USB/IR camera?
3. UI language at launch: Vietnamese, English, or both?
4. Hosting: GitHub Pages or Cloudflare Pages?
5. Who are the 2–3 reference test devices?

## 20. References

- MediaPipe Face Landmarker for Web — <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js>
- FaceLandmarker options — <https://developers.google.com/edge/api/mediapipe/js/tasks-vision.facelandmarkeroptions>
- Bouraffa et al., *Deep Learning-based rPPG Models towards Automotive Applications*, WACV 2025 Workshops — <https://openaccess.thecvf.com/content/WACV2025W/HAVI/html/Bouraffa_Deep_Learning-based_rPPG_Models_towards_Automotive_Applications_A_Benchmark_Study_WACVW_2025_paper.html>
- Quality-Based rPPG Compensation for Camera-Based Driver Monitoring (TRID) — <https://trid.trb.org/View/2512205>
- Nowara et al., *SparsePPG: Towards Driver Monitoring*, CVPR 2018 Workshops — <https://www.merl.com/publications/docs/TR2018-067.pdf>
- Euro NCAP 2026 protocol changes (driver monitoring) — <https://www.euroncap.com/en/press-media/press-releases/euro-ncap-announces-2026-protocol-changes-to-tackle-modern-driving-risks>
- Ultralytics licensing (AGPL-3.0 / Enterprise) — <https://pypi.org/project/ultralytics/>
- Vietnam PDP Law 91/2025/QH15 overview — <https://luatvietnam.vn/legal-updates/the-latest-law-on-personal-data-protection-and-the-guiding-documents-892-106778-article.html>
- Related open-source projects: `LukeConran/ready-alert`, `srujan-s22/driver-drowsiness-detector`, `OmerKhan33/driver-drowsiness-detection-system`
