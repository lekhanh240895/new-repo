# Changelog

## Unreleased

### Alert accuracy (P1–P8)
- Scenario library (122 cases) with a ratchet; context-aware alarms (speed, turns, gaze zones,
  attention buffer, face-lost context, robust eye closure, step-down) — see
  `docs/ALERT_ACCURACY_PLAN.md`.
- **Real clips (P7):** head-down and head-turn signs were wrong and are fixed
  (`pose.headDownSign` +1, `pose.yawRightSign` −1); a real eye closure alarms in 1.0 s with glasses.
- **Drive check (P8):** the trip summary checks GPS speed and the turn sensor after a real
  drive; "Save drive log" (numbers only, no position); `npm run drive-check`.
- New UI (cards, status orb, alarm panel), tap to end a trip, dev tools hidden in production.

### Known limits
- The gyroscope turn sign (`motion.turnRightSign`) still needs a real drive.
- An eyes-down look where the lids cover the eyes reads like closed eyes (L alarm, on purpose).
- Sunglasses are not detected automatically.

## v0.1.0 — first public preview

> Not a certified safety device. Tested with replayed video, not yet in real driving.

### What it does
- Runs fully in the phone's browser. **No video leaves the device**, no server, no account.
- Trip flow: setup check (face, light, distance, test beep, screen-on) → 8 s per-driver
  calibration → **Dark Cockpit** monitoring (black screen, one small status dot).
- Detects **microsleep** (eyes closed ≥ 1.0 / 1.5 / 2.0 s → three alarm levels),
  **eyes off road** (≥ 2.0 s; mirror checks ignored), and **growing fatigue**
  (PERCLOS, slow blinks, yawns — talking ignored — and head nods).
- Alarms stop by themselves 2 s after the eyes open, then suggest a break. "I'm awake" works but is never required.
- Fails loud: chimes and says so when it cannot see the driver, when paused, or on any fault, and recovers by itself.
- English and Vietnamese UI and voice (falls back to English voice if the phone has no Vietnamese voice).
- Installable, **works offline** after the first trip.

### Engineering
- MediaPipe Face Landmarker in a Web Worker (main-thread fallback), GPU/CPU picked by a start-up benchmark.
- Model and wasm self-hosted and verified against SHA-256 hashes; strict Content-Security-Policy.
- 150+ unit and controller tests; replay harness runs the real pipeline on video in headless Chromium;
  CI runs a smoke test under the production CSP and an offline test.
- Failure-mode coverage: `docs/FAILURE_MODES.md`.

### Known limits
- Daytime only (no infrared on phone front cameras).
- Sunglasses are not detected yet (degraded mode exists but is not triggered automatically).
- iPhone: no vibration; background behavior is stricter. Android Chrome is the main target.
- The head-pitch sign (`pose.headDownSign`) still needs a check on a real phone.
