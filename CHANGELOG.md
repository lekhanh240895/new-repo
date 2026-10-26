# Changelog

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
