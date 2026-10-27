# P7 — Real-clip recording guide

The scenario library (P1–P6) is synthetic. Its numbers for things like "how low the lids
drop on a speedometer glance" are guesses. P7 checks them on **your real face, your phone,
your car**. You record short clips; `npm run clips` plays each one through the real model and
the real alarm logic, and says pass or fail.

## Safety and privacy first

- **Never record while driving.** Record parked with the engine off, or at a desk. Acting out
  a microsleep or a phone look while driving is the danger this app exists to prevent. The
  car's speed is simulated in the manifest.
- **Only record yourself**, or someone who has agreed. Clips show a real face.
- Clips stay in `clips/` on your computer. **Git ignores this folder: never commit or upload
  it.** Delete the clips when you are done.
- To get help with tuning, send the report (`clips/CLIP_REPORT.md`, text only). If more
  detail is needed, `npm run clips -- --share` writes per-frame numbers (eye openness, head
  angles…) without landmark points to `clips/share/`. Look at them before you send them:
  they are still measurements of your face over time.

## Setup

1. Put the phone in the mount where you use it while driving. Front camera, landscape or
   portrait as usual, 720p or 1080p, 30 fps. Good daylight unless the clip is about light.
2. Every clip starts the same way: **10 s looking at the road, blinking normally.** This is
   the calibration (`"calibrate": [0, 10]`), like the start of a trip.
3. Keep a stopwatch visible to you (not to the camera), or say the actions out loud, so you
   can write down when each thing happened. After recording, play the clip and note the
   second each action starts — that is the most accurate. Marks can be off by ±0.3 s; the
   expectations in the example leave room for that.
4. Copy the files to `clips/` with plain names (letters, digits, `-`, `_`, `.`), e.g.
   `c01-speedometer.mp4`.
5. Copy `docs/clips.manifest.example.json` to `clips/manifest.json` and edit it: file names,
   marks (seconds from the start of the video), what should happen.
6. Run (needs `ffmpeg` for .mp4/.mov; .y4m works as is):

   ```bash
   npm run build          # the clips play through the built app
   npm run clips          # all clips → clips/CLIP_REPORT.md
   npm run clips -- --only C01
   ```

   Each clip takes about its own length plus ~10 s (the model runs in a headless Chromium on
   the CPU, so results are the same on every machine).

## The clips (in order of value)

Each clip that tests a "no false alarm" condition also ends with a **real 3 s eye closure**.
That checks the condition does not hide a real microsleep (the must-alarm side).

| ID | What to do (after the 10 s calibration) | Length | Checks |
| --- | --- | --- | --- |
| **SIGNS** | 0–5 s straight · 5–9 s turn the head right ~40° · 9–10 straight · 10–14 tilt the head down ~25° · 14–15 straight · 15–19 head still, **eyes only** to the right · 19–20 straight · 20–24 head still, eyes down to the speedometer | 25 s | The direction signs in the config (no calibration needed) |
| **R01** | Look at the road, then close the eyes 3 s at ~15 s | 25 s | The basic microsleep alarm on your face |
| **C01** | Five speedometer glances of ~1.5 s, 5 s apart; then close the eyes 3 s | 45 s | Lids dropping when looking down are not "closed" (T8) |
| **B01** | Look down at a phone in your lap for 4 s at ~15 s; 10 s road | 30 s | Phone → distraction alarm, not microsleep |
| **B05** | Road; at ~12 s look at the phone in your lap and keep looking until ~23 s | 30 s | Green light: alarm right after "moving off" at 20 s (speed simulated) |
| **C04** | Laugh hard ~2 s at ~15 s; road; close the eyes 3 s at ~25 s | 35 s | Laughing is not a microsleep (T9); real closure still alarms |
| **C05** | Fake a sneeze at ~15 s; road; close the eyes 3 s at ~25 s | 35 s | Sneeze (T9) |
| **C06** | Big yawn with squeezed eyes at ~15 s; road; close 3 s at ~25 s | 35 s | Yawn (T9) |
| **A35** | Head still, eyes only to the left mirror for 1.5 s, three times | 30 s | Eye-only glances are not distraction |
| **D01** | Act very tired: lids half closed for 6 s at ~15 s, no full closure | 30 s | Heavy-lid rule → L1 within 4 s |
| **C03 / E09** | Squint into a low sun (or a bright lamp) for 60 s; then close 3 s | 75 s | Squint is not closure, no fatigue advisory |
| **D07** | Sunglasses on from the start; road 30 s; close 3 s (cannot be seen) | 45 s | "Eyes hidden" is announced |
| **C10** | Glasses with a reflection (tilt toward a window) for 30 s; close 3 s | 45 s | Lens reflection is not closure |
| **C16** | Cap pulled low (shadow on the eyes) 30 s; close 3 s | 45 s | Shadow is not closure |
| **C18** | Heavy eye makeup / lash extensions (if it applies); close 3 s | 30 s | Calibration and closure with makeup |
| **E03** | Three yawns behind a hand, 10 s apart | 45 s | Hidden yawns (record what the model sees) |
| **E04** | Face mask on; talk for 30 s | 40 s | Talking with a mask is not yawning |

For C03, C10, C16, C18, add both expectations to the manifest:
`{ "kind": "noAlarm", "family": "L", "to": "sleep" }` and
`{ "kind": "alarm", "family": "L", "after": "sleep", "within": 1500 }`.

## Reading the report

- **✅ pass / ❌ fail** per clip, the alarms the app raised (seconds from the video start),
  and the reason for each failure.
- **Calibration** "failed: no-blinks" means the first 10 s had fewer than 2 blinks; the clip
  then uses rough values and its result is less trustworthy. Re-record with normal blinks.
- **Face found** below ~90% means the camera lost the face often (angle, light, distance).
- **Sign check**: ❌ "change it" means a config sign is wrong for your phone. Each is one value
  in `src/core/config.ts` (`pose.*`). The scenario library maps directions through these
  signs, so it stays valid after a change.

## What happens next

Send the report. Failures become fixes the same way as P2–P6: change the logic or a
threshold, check that every synthetic case still passes (ratchet), re-run the clips. A clip
that shows a synthetic assumption was wrong (for example, lids drop more than assumed on a
speedometer glance) also updates the matching scenario, so the library learns from it.
