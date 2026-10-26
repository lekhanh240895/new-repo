# Failure-mode coverage (SPEC §12)

How each of the 20 failure modes in the spec is handled, and how we know it works.

- ✅ **Automated**: covered by unit, controller or replay tests (`npm test`, `npm run smoke`).
- 🖐 **Manual**: needs a real phone; follow the check in the last column.
- ⚠️ **Partial / later**: not fully handled yet, with the milestone that closes it.

| # | Failure | Status | Where it is handled | How it is checked |
| --- | --- | --- | --- | --- |
| F1 | Glare / backlight | ✅ | `core/signals/quality.ts` (luma > 220 for 1 s → `LOW_VISIBILITY`); setup hint "too bright" | `quality.test.ts` "glare / backlight" |
| F2 | Night / tunnel | ✅ | Quality gate: no face + dark frame → `LOW_VISIBILITY`; "monitoring off" chime after 10 s; setup fails with "Too dark" | `quality.test.ts`, `controller.test.ts` "too dark", CI smoke replay (dark clip) |
| F3 | Sunglasses | ⚠️ | State machine degraded mode is done (head drop instead of eyes, capped at L2). **Detecting** sunglasses (`EYES_HIDDEN`) needs real recordings | `monitoring.test.ts` "degraded mode" — detection: M3 with recorded clips |
| F4 | Narrow / single-lid eyes, squinting | ✅ | Per-driver calibration (`core/calibration`), openness relative to the driver's own EAR, blendshape fusion | `baseline.test.ts` "narrow eyes", `pipeline.test.ts` "narrow eyes are not closed" |
| F5 | Road vibration | ✅ | One Euro filter per signal type; shake gate marks frames invalid after 0.5 s | `smoothing.test.ts`, `quality.test.ts` "heavy shake" |
| F6 | Heat / slow device | ✅ | GPU/CPU benchmark at start (keeps the faster); frame width 480 → 320 px after 5 s under 10 fps; at most one frame in flight | `controller.test.ts` performance tests; real GPU replay (GPU 194 ms → CPU 48 ms) |
| F7 | Screen sleeps | ✅ 🖐 | Wake Lock on start and again on return to the page; setup shows "Screen stays on" | `controller.test.ts` F10/F7 test. Manual: leave the phone untouched 2 min during a trip |
| F8 | Audio blocked by autoplay rules | ✅ 🖐 | Audio unlocked inside the Start tap; silent keep-alive; "Sound is blocked: visual alerts only" if not ready | `controller.test.ts` "unlocks audio in the tap". Manual: start a trip, trigger a test alarm, hear it |
| F9 | GPU context lost | ✅ 🖐 | Worker crash → watchdog/`onFatal` → engine restart (up to 3), GPU → CPU fallback | `controller.test.ts` F20 test (same path). Manual: open a heavy 3D page in another tab mid-trip |
| F10 | App hidden (call, tab switch) | ✅ 🖐 | `SUSPENDED` + "paused" chime; resume re-checks the camera and wake lock | `session.test.ts`, `controller.test.ts` F10. Manual (iOS especially): switch apps and back |
| F11 | Talking / singing seen as yawning | ✅ | Yawn needs ≥ 1.2 s wide open and no fast open/close cycles before it | `detectors.test.ts` "singing", `pipeline.test.ts` "talking" |
| F12 | Hand on face, drinking | ✅ | Face lost < 1.5 s → `OCCLUDED`; a normal blink just before does not alarm | `monitoring.test.ts` "hand covers the face", `quality.test.ts` |
| F13 | Mirror / blind-spot check | ✅ | Eyes-off-road alarm only after 2.0 s continuous | `monitoring.test.ts`, `pipeline.test.ts` "mirror check" |
| F14 | The app itself distracts | ⚠️ | Monitoring screen is black with one small dot; no preview after setup | Dark Cockpit polish (hide title/tabs, full-screen) in M3 |
| F15 | Startle from a sudden alarm | ✅ | Alarm ladder L1 → L2 → L3 with rising sound; flashing ≤ 3 Hz; reduced-motion respected | `monitoring.test.ts`, `platform.test.ts` "alarm sounds" |
| F16 | Phone mount moves | ✅ | Pose far from baseline for 30 s → "Phone moved? Re-calibrate" (background re-calibration) | `pipeline.test.ts`, `controller.test.ts` F16 |
| F17 | Passenger face in view | ✅ | Model tracks 2 faces; after calibration the face nearest the calibrated position is the driver | `features.test.ts` "pickDriverIndex", `controller.test.ts` "calibrated face position" |
| F18 | Low battery / overheating | ⚠️ | Overheating shows up as low fps → handled by F6. Battery warning not built yet | M3 (Battery Status API, Android only) |
| F19 | Camera lost / permission revoked | ✅ | Track `ended` → `FAULT CAMERA_LOST` + chime → reopen once → resume; denied → clear message | `controller.test.ts` F19, "camera denied" |
| F20 | Worker or model stalls | ✅ | Watchdog: no frame for 1 s (10 s grace for the first frame: GPU warm-up) → restart engine | `platform.test.ts` watchdog, `controller.test.ts` F20 + "GPU warm-up" |

## End-to-end replay checks (real model, headless Chromium)

These use a test video made from a public-domain portrait, with eyes painted
closed on some frames. The video is not in the repo (no faces of real people
are committed); see "Replay a video" in the README to make your own.

| Scenario | Result |
| --- | --- |
| Trip with blinks, then eyes closed 2.6 s (CPU) | Setup 1.7 s → calibration (exact, first attempt) → L1 at +1.0 s, L2 +1.5 s, L3 +2.0 s → stop 2 s after eyes open → break advisory |
| Same, default GPU mode | GPU benchmark 194 ms vs CPU 48 ms → switched to CPU → same alarm sequence; no false alarm in 30 s of normal blinks |
| Dark clip | `SETUP_FAILED`: "Too dark. Monitoring needs light on your face." |

## Still to check on a real phone

1. **Pitch sign**: nod down in Debug mode — pitch should go negative. If not, set `pose.headDownSign` to `1` in `src/core/config.ts`.
2. F7, F8, F9, F10 manual checks above (iPhone and Android).
3. Real blink and closure values on your face (Debug mode charts).
