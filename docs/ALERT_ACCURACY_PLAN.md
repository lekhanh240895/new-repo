# Alert accuracy plan — 100 failure cases (+2 found while building)

**Goal:** fewer false alerts when the driver looks away *for driving* (intersections,
mirrors, red lights, parking), **without** missing real distraction or microsleep.

**Status:** approved (all 5 decisions in section 6: yes). P1 done: every case is a scenario in
`src/scenarios/`; results on v0.1 code are in [SCENARIO_REPORT.md](SCENARIO_REPORT.md).

---

## 1. Why the current rules are too simple

Today, "eyes off road" is one rule (SPEC §10.3):

- off road = head turned > 30°, **or** head down > 20°, **or** eyes down (head straight)
- **D1** after 2.0 s continuous, **D2** after 3.5 s, or > 6 s total in 30 s
- no idea **where** the driver looks, **how fast** the car goes, or **whether it is turning**

So a left-right check at an intersection, mirror checks in heavy motorbike traffic, or
looking around at a red light all count the same as texting. The eye-closure rule has a
similar problem: looking down at the speedometer lowers the eyelids and can look like
"eyes closed".

## 2. The fixes (T1–T15)

Each failure case below points to one or more of these fixes.

| # | Fix | What it does |
| --- | --- | --- |
| **T1** | **Speed context** | Use GPS speed. Stopped (< 5 km/h): no distraction alarms. Slow (5–25 km/h, intersections, parking): longer budget. Fast: normal or stricter. Suggest turning location on during onboarding (location stays on the phone). |
| **T2** | **Motion sensors** | The mounted phone feels the car. **Gyroscope**: the car is turning → looking into the turn is expected. **Accelerometer**: "stopped" when GPS is missing; road bumps and hard braking (to ignore fake nods). |
| **T3** | **Gaze zones** | Combine head angle + eye direction (MediaPipe `eyeLookIn/Out/Up/Down` blendshapes) into one gaze direction relative to the calibrated "road ahead". Map it to zones: road, left mirror/window, right mirror/window, rear-view mirror, instrument cluster, center console, lap/phone, blind spot. Each zone has its own time budget. |
| **T4** | **Attention buffer** (replaces fixed D1/D2) | Based on the AttenD method (Kircher & Ahlström, 2009). A 2 s "attention buffer" drains while the eyes are off the road and refills when they come back. Mirrors and the speedometer only start draining after a 1 s grace period. Lap/phone drains faster. Alarm when the buffer is empty. Handles many short glances (texting) and long single glances in one rule. |
| **T5** | **Scanning detector** | Left → right → left glances with short dwell (< 1.5 s each) at low speed or while turning = checking traffic. Counts as a driving task. Only left/right patterns qualify, never down. |
| **T6** | **Hysteresis and debounce** | Separate "enter" and "exit" angles (e.g. enter off road at 30°, return at 22°) and a minimum dwell (150 ms), so noisy frames don't flicker in and out. Eye closure tolerates a single noisy "open" frame. |
| **T7** | **Auto re-centering** | "Road ahead" slowly follows where the driver mostly looks while driving fast (posture change, seat moved). Strict limits: max ±10°, never drifts toward the lap or phone. |
| **T8** | **Robust eye closure** | Correct for downward gaze (eyelids drop when looking down), squinting in sun (`eyeSquint`), and per-eye calibration. A very large head turn makes eye state "unknown", not "closed". |
| **T9** | **Expression context** | Yawn, laugh or sneeze often close the eyes for 0.5–2 s. While one is in progress, give 1 extra second before a microsleep alarm. If the eyes stay closed after the mouth closes, alarm as usual. |
| **T10** | **Smarter alarm behavior** | Step the alarm down when the driver clearly reacts. Recovery tolerates a short mirror glance. Rate-limit soft beeps (D1). Immediate alert if the car starts moving while the eyes are still down (green light). |
| **T11** | **Clean fatigue signals** | Leave speedometer glances out of PERCLOS. Ignore "nods" caused by bumps or braking (accelerometer) and rhythmic nods (music, talking). Turn off yawn detection when a face mask is worn. |
| **T12** | **Personal adaptation** | After the trip (parked), the driver can mark an alert as "false". Small, bounded per-driver threshold changes (±20%), never below a safety floor. |
| **T13** | **Scenario library + self-improve loop** | All 100 cases become scripted test traces with an expected result. A tuning script tries config variants, scores them, and keeps the best one with **zero misses** on must-alarm cases. This is the "self improve" loop. |
| **T14** | **Real-clip validation** | Record short scripted clips (parked or at a desk) for the cases that depend on real faces (squint, mask, sunglasses, eye-only glances). The replay harness checks the expected alert. |
| **T15** | **Face-lost context** | If the head was turning fast just before the face disappeared, treat it as a blind-spot check (up to 1.5 s), then as distraction. If the head was dropping fast, treat it as microsleep. |

**Test type** in the tables: **S** = synthetic trace (runs in CI), **R** = needs a real
recorded clip, **D** = needs a phone sensor (GPS / motion; simulated in tests, then
checked on a device).

**Expected** is what the app *should* do after the fix.

---

## 3. The 100 cases

### A. Looking away *for driving* — false distraction alerts (38)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| A01 | Check left at an intersection before crossing (head 40–60°, 1–2.5 s), slow | D1 if ≥ 2 s | No alert | T1, T3, T5 | S, D |
| A02 | Left-right-left scan at an intersection (3 glances, ~1.2 s each) | D2 possible when several intersections fall in 30 s | No alert | T4, T5 | S |
| A03 | Stopped at a red light, looking around (10–60 s) | D1 → D2 (no alarm only if location is on) | No alert | T1, T2 | S, D |
| A04 | Stopped at a red light, watching the countdown light (up/side, 5–20 s) | D1 if it is to the side | No alert | T1 | S, D |
| A05 | Right turn: looking right into the turn for 2–3 s | D1 | No alert | T2, T3 | S, D |
| A06 | Waiting to turn left across traffic: left, right, left (0–5 km/h) | D1 / D2 | No alert | T1, T5 | S, D |
| A07 | Lane change: mirror + shoulder check (head 70–90°, face lost ~1 s) | D1 (off-road time carried while face is lost) | No alert if ≤ 1.5 s | T3, T15 | S |
| A08 | Lane change right: right mirror is far (head 50–70°, ~1.5–2 s) | D1 near 2 s | No alert up to 2.5 s | T3 | S |
| A09 | Rear-view mirror glances (up-right, 0.5–1.5 s), repeated in heavy traffic | Adds up toward D2 | No alert | T3, T4 | S |
| A10 | Side-mirror checks for motorbikes every 3–5 s (1 s each), city | **D2** (6 × 1 s = 6 s in 30 s) | No alert | T4 (mirror grace) | S |
| A11 | Speedometer glance (down 15–25°, 0.5–1.2 s), repeated | Adds up; D2 possible | No alert | T3, T4 | S |
| A12 | Glance at the car's own center screen / radio (1–1.5 s) | Adds up | No alert for single short glances; alert if repeated a lot | T3, T4 | S |
| A13 | Reversing / parking: looking back for 3–10 s at < 10 km/h | D2 | No alert | T1, T15 | S, D |
| A14 | Parking lot, slow maneuvering, looking around | D1 / D2 | No alert | T1 | S, D |
| A15 | Toll booth / parking ticket: stopped, turned to the window | D2 | No alert | T1 | S, D |
| A16 | Talking to a passenger while stopped | D1 / D2 | No alert | T1 | S, D |
| A17 | Short looks at a passenger while driving (0.5–1 s, with ≥ 2 s on the road between) | D2 via 6 s / 30 s | No alert | T4 | S |
| A18 | Merging onto a highway: long left-mirror check (2–2.5 s) | D1 | No alert up to 2.5 s | T3 | S |
| A19 | Roundabout: head keeps swinging left while the car turns | D1 / D2 | No alert | T2, T5 | S, D |
| A20 | Railway crossing: left, right, left while slow | D1 / D2 | No alert | T1, T5 | S, D |
| A21 | School zone / crosswalk: scanning at low speed | D1 | No alert | T1, T5 | S, D |
| A22 | Mountain pass curves (e.g. Hải Vân): head follows the road 30–45° for seconds | D1 | No alert | T2, T7 | S, D |
| A23 | Phone mounted far to the side (calibrated yaw 30–40°) | Asymmetric, noisy angles → false off-road | No alert; setup warns "mount closer to center" if > 35° | T3 + setup check | S |
| A24 | Driver leans back / moves the seat mid-trip | Off road until re-calibrated (30 s prompt) | Re-center within ~15 s, no alert | T7 | S |
| A25 | Reading an overhead sign (up 15–25°, < 2 s) | No alert (up is not counted) | No alert (keep) | Regression | S |
| A26 | Quick look at a motorbike cutting in (0.5–1 s) | No alert | No alert (keep) | Regression | S |
| A27 | Traffic jam crawl (0–5 km/h), long mirror looks | D1 / D2 | No alert | T1 | S, D |
| A28 | Traffic police waving at the roadside: look 2–3 s while slowing | D1 | No alert under 30 km/h; soft only above | T1 | S, D |
| A29 | Looking for a house number at 10–20 km/h (2–4 s glances) | D1 / D2 | Soft alert only after 3.5 s | T1 | S, D |
| A30 | Stopped at a food stall / drive-through | D1 / D2 | No alert | T1 | S, D |
| A31 | Wiping the fogged windshield (hand partly covers the face) | Face lost → "monitoring off" chime | No distraction alert; "occluded" | T15 | S, R |
| A32 | Adjusting the rear-view mirror (up-right 2–3 s) | D1 | No alert up to 3 s | T3 | S |
| A33 | Quick glance at the BioMonitor screen itself during an alert (< 1.5 s) | Keeps the alarm going | Does not escalate | T3, T10 | S |
| A34 | Head turned 35° but **eyes back on the road** | Off road (head angle only) | On road | T3 (eye + head) | S, R |
| A35 | Eyes-only glance at the mirror (head straight, eyes 30° to the side) | Not counted | No alert (keep) | Regression | S, R |
| A36 | Blind-spot check with face lost for 1 s | Off-road time carried → D1 if total ≥ 2 s | No alert up to 1.5 s | T15 | S |
| A37 | Smiling / squinting: iris hard to see → false "eyes down" | False off-road flicker | On road | T3, T6 | S, R |
| A38 | Glasses reflection on the iris → gaze jumps | False off-road flicker | On road | T6 (+ gaze confidence) | S, R |

### B. Real distraction that must still alert — missed or late today (14 + 1)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| B01 | Texting with the phone in the lap: eyes down, head almost straight | Relies on iris "eyes down"; low eyelids may look like *closed* → wrong alert type | D alert in ≤ 2 s, labeled distraction | T3, T8 | S, R |
| B02 | Repeated phone glances (1.5 s each, 1 s road between) for 30 s | Late (only via 6 s / 30 s) | Alert after ~3 glances (≤ 8 s) | T4 | S |
| B03 | Phone held low behind the steering wheel (small eye-down angle) | Missed | D alert | T3 (calibrated vertical road gaze) | S, R |
| B04 | Long talk with a passenger at speed (head 30–40°, 3 s+) | D1 / D2 | Still alerts (regression after the A fixes) | T4 | S |
| B05 | Using the phone at a red light; the car starts moving, eyes still down | Count starts from 0 when moving → +2 s late | Alert within 1 s of moving off | T10 | S, D |
| B06 | Turning to the back seat (child) at speed; face lost fast | Face lost → only a chime after 10 s | D alert in ≤ 2 s | T15 | S |
| B07 | Eating / drinking, head down, hand near the face, while moving | Partly missed (occluded) | D alert if > 2 s | T3, T15 | S, R |
| B08 | Reading a paper on the steering wheel | Missed (small down angle) | D alert | T3 | S, R |
| B09 | Rubbernecking at a crash (head 45°, 3–4 s, at speed) | D1 / D2 | Still alerts (regression) | T4 | S |
| B10 | Watching a video on the center screen (3 s+) | D1 | Still alerts (console budget not too generous) | T3, T4 | S |
| B11 | Driver often looks at the phone at speed; re-centering slowly drifts toward the phone | (Risk created by T7) | Re-centering never moves toward lap/phone zones | T7 guard | S |
| B12 | Phone ↔ road alternation looks like "scanning" | (Risk created by T5) | Not scanning: down glances never count as scanning | T5 guard | S |
| B13 | GPS lost in a tunnel or city canyon → speed unknown | (Risk created by T1) | Unknown speed = moving (alarms stay on) | T1 guard | S, D |
| B14 | Smooth highway: accelerometer says "stopped" by mistake | (Risk created by T2) | Accelerometer "stopped" only without GPS, very still for ≥ 3 s, and no rotation | T2 guard | S, D |
| B15 | **Found in P2:** staring out of the side window through a long curve | (Risk created by T2: "looking into the turn" had no time limit) | Allowed for 4 s, then an immediate alarm | T2 guard | S, D |

### C. False "eyes closed" (microsleep) alerts (18)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| C01 | Looking down at the speedometer: eyelids drop, EAR −40% | Can read as closed | Open (looking down) | T8 | S, R |
| C02 | Looking down at a phone, read as microsleep | Wrong alert type (L instead of D) | D alert, not L | T3, T8 | S, R |
| C03 | Squinting into a low sun for minutes | L1 / L2; PERCLOS rises | No microsleep alert | T8 (`eyeSquint`) | R |
| C04 | Laughing hard: eyes squeezed 1–2 s | L1 / L2 | No alert | T9 | S, R |
| C05 | Sneezing: eyes shut 0.5–1.2 s + head jerk | L1 possible | No alert | T9 | S, R |
| C06 | Yawning with eyes squeezed 1–2 s | L1 / L2 | Fatigue counted, no microsleep alarm unless eyes stay closed after the yawn | T9 | S, R |
| C07 | Rubbing the eyes (blink, then hand covers the face) | Closure carried → L1 | Occluded, no alert | T15 | S, R |
| C08 | Resting the eyes 3 s at a red light | L3 (if location is off) | Fatigue advisory, not an alarm | T1 | S, D |
| C09 | Narrow eyes + head-down posture | False closed | Open | T8 | S, R |
| C10 | Light reflection on glasses hides one eye | False closed | Eye state "unknown" | T8 | R |
| C11 | Winking / one eye irritated | Mean stays open → OK | No alert (keep) | Regression | S |
| C12 | Droopy eyelid on one side (ptosis) | Low mean openness | Per-eye calibration → no alert | T8 | S |
| C13 | Dusk: noisy EAR flickers to "closed" | Flicker | No alert | T6 | S |
| C14 | Auto-exposure jump under a bridge (1–2 bad frames) | Usually fine | No alert (keep) | T6 | S |
| C15 | Braking + looking at the cluster | Same as C01 | Open | T8 | S |
| C16 | Cap shadow over the eyes | Dark eyes → noisy | Eye state "unknown" if the eye region is too dark | T8 | R |
| C17 | Head turned 55–70°: both eyes unreliable | Can read as closed | "Unknown", not closed | T8 | S |
| C18 | Makeup / eyelash extensions | Calibration handles it | No alert (keep) | Regression | R |

### D. Missed or late microsleep (10)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| D01 | Heavy eyelids: 50–60% closed for a long time | Never "closed" (threshold is 70% closed) | "Drowsy eyes" alert after 3 s | New heavy-lid rule | S |
| D02 | Sleeping with eyes half open (staring, no eye movement) | Missed | Alert when low openness + no eye movement + head sinking | New stare rule (research) | S, R |
| D03 | Head drops first, face lost before the eyes count as closed | Only a chime after 10 s | L1 within 1 s | T15 | S |
| D04 | Head rolls sideways during sleep | Works | Alert (keep) | Regression | S |
| D05 | One noisy "open" frame in the middle of a real closure | Timer restarts → late L1 | L1 on time | T6 (gap tolerance) | S |
| D06 | Eyes close while the head is turned 40° | Near eye used → OK | Alert (keep) | Regression | S |
| D07 | Sunglasses: eyes hidden, degraded mode never starts | Missed | Detect sunglasses → head-drop rules | New sunglasses detector | R |
| D08 | Microsleep while creeping in a traffic jam (3–8 km/h) | No alarm (not armed) | Microsleep alarms armed from 3 km/h | T1 (separate arming) | S, D |
| D09 | Repeated near-microsleeps of 0.8–0.9 s | Only "slow blink" count → late advisory | L1 after 3 such closures in 60 s | New cluster rule | S |
| D10 | Slow phone at 8 fps: coarse timing | Not tested | Alerts within one frame of the rule | Test at 8 fps | S |

### E. Fatigue advisory mistakes (10 + 1)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| E01 | Talking / singing for a long time | No yawns counted | No yawns counted (keep) | Regression | S |
| E02 | Chewing gum / eating | Not tested | No yawns counted | T11 | S |
| E03 | Yawning behind a hand (very common) | Missed | Counted as a possible yawn (lower weight) | New rule | R |
| E04 | Wearing a face mask (very common in Vietnam) | Mouth landmarks are guessed → wrong MAR | Yawn detection off, with a small note | T11 (mask detector) | R |
| E05 | Speedometer glances raise PERCLOS | PERCLOS too high | Down-gaze frames excluded | T11 | S |
| E06 | Road bumps shake the head → counted as nods | False nods | Ignored | T2, T11 | S, D |
| E07 | Hard braking pitches the head forward | False nod | Ignored | T2, T11 | S, D |
| E08 | Nodding along to music / "yes" while talking | False nods | Ignored (rhythmic, eyes open) | T11 | S |
| E09 | PERCLOS inflated by squinting in sun | False advisory | No advisory | T8 | R |
| E10 | Early fatigue: blinks slowly get longer over an hour | Only caught late | Advisory when blink length rises > 30% over the trip baseline | New trend rule | S |
| E11 | **Found in P1:** phone or speedometer glances (head down and back) count as head nods → "You are tired" within seconds | False fatigue advisory; STRONG fatigue also makes microsleep alarms more sensitive | No fatigue advisory from glances; a nod needs heavy eyes around the drop | T11 | S |

### F. Alarm behavior and sensor issues (10)

| ID | Situation | Today | Expected | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| F01 | Driver looks at the phone to see the alarm → still "off road" → alarm continues | Feedback loop | Short D recovery (1 s on road); the alarm never invites a look | T10 | S |
| F02 | After a microsleep alarm the eyes are wide open, but the head points at the phone | Siren continues | Step down to a soft beep once the eyes are clearly open | T10 | S |
| F03 | Mirror glance during recovery restarts the 2 s count | Long alarm | Recovery allows one short mirror glance | T10 | S |
| F04 | Long tunnel: too dark | "Monitoring off" chime | Same (keep; honest) | Regression | S |
| F05 | Leaving a tunnel: brief over-exposure | Short occlusion | No alert (keep) | Regression | S |
| F06 | Very bumpy rural road: shake gate drops frames → eye closure unknown | Microsleep can be missed | Eye closure still counted if both eyes and blendshape agree; only pose is dropped | Shake-gate change | S |
| F07 | Passenger leans toward the driver's position | Driver chosen by position → OK | Keep | Regression | S |
| F08 | Night: face not visible | Grey dot + chime | Same (keep; honest) | Regression | S |
| F09 | City driving: too many soft beeps → driver turns the app off | Not measured | Soft beep at most once per 30 s unless escalating; "alerts per hour" in the trip summary | T10 | S |
| F10 | Calibration done while looking around at a red light | Rejected as "moving" (OK) | Keep; plus automatic re-centering later | T7 | S |

**Totals:** A 38 + B 15 + C 18 + D 10 + E 11 + F 10 = **102** (E11 found in P1, B15 found in P2).
By test type: **94** have a synthetic trace that runs in CI (52 synthetic only). **25** also need a
real clip (8 of them can *only* be tested with a real clip), and **25** also need a check with
real phone sensors (GPS / motion).

---

## 4. Implementation order (after approval)

| Phase | Work | Covers |
| --- | --- | --- |
| **P1** | Scenario library: the 100 cases as scripted traces with expected results; report script; **run on today's code** to see how many fail | T13 (baseline numbers before any change) |
| **P2** | Context signals: GPS speed (onboarding suggests turning it on), motion sensors, gaze zones (head + eye blendshapes), hysteresis | T1, T2, T3, T6 |
| **P3** | Attention buffer instead of fixed D1/D2; scanning detector; turn context; face lost during a turn | T4, T5, T15 |
| **P4** | Eye-closure robustness: down-gaze, squint, expressions, gap tolerance, heavy lids, near-microsleep cluster | T8, T9, D01, D09 |
| **P5** | Alarm behavior: step down, recovery tolerance, rate limit, "green light" alert | T10 |
| **P6** | Self-improve loop: config tuning against the scenario library (zero misses on must-alarm cases); trip review "false alarm" marking | T12, T13 |
| **P7** | Real-clip validation for the R cases (you record, parked or at a desk) | T14 |

**Done when:**
- All 94 synthetic traces pass in CI.
- **Zero misses** on every case where the expected result is an alert (B, D and the must-alarm C cases).
- Recorded clips pass for the R cases you were able to record.

### P1 results (v0.1 code)

**40 pass, 53 fail, 8 need a real clip** — details per case in [SCENARIO_REPORT.md](SCENARIO_REPORT.md).

Found while building P1:
- **E11 (new):** glancing down at a phone and back is counted as a head *nod*, so the app says
  "You are tired" within seconds — and STRONG fatigue makes microsleep alarms more sensitive.
- **Boundary gap:** no passing scenario sits just under a threshold (for example a legitimate
  1.8 s glance), so the ratchet would not notice if a threshold got tighter. P6 adds boundary
  cases before any automatic tuning.
- **C13** (dusk noise) and **C17** (60° head turn) already pass: the M2 smoothing removes
  single-frame flicker. C17 depends on assumed eyelid values and needs a real clip.

### P2 results (speed context, motion sensors, gaze zones, hysteresis)

**66 pass, 28 fail, 8 need a real clip** (was 40 / 53 / 8). **25 improved, 0 regressed.**

What changed:
- **Gaze zones (T3):** head + eyes combined, then mapped to road / up / left mirror / right mirror /
  rear-view / speedometer / center console / lap / left side / right side. Iris and blendshape
  ("two opinions") must agree before the eyes count as looking somewhere.
- **Budgets:** mirrors 2.5 s, rear-view 3.0 s, side / speedometer / console / lap 2.0 s.
  Mirrors, rear-view and speedometer no longer add to the "time off road within 30 s" total.
- **Speed (T1):** < 3 km/h no alarms (closed eyes ≥ 2 s → one advisory, C08); < 10 km/h microsleep
  alarms only; 10–30 km/h side and mirror looks get 3.5 s. **Phone, lap and console never relax.**
- **Motion (T2):** looking into a turn counts as driving for up to 4 s, then an immediate alarm (B15).
- **Hysteresis (T6):** zones must last 150 ms; leave the road at 30°, come back at 22°; one noisy
  "open" frame no longer restarts an eye closure (D05).
- **Mount check (A23):** calibration warns when the phone is more than 35° to the side.

Trade-off you should know about: **B13 and B14** (alarms stay on without GPS / with a wrong
"still" reading) still alarm, but a 50° look to the left now falls in the left-mirror zone, so the
alarm comes at ~2.7 s instead of within 2.5 s. Their limit moved to 3.0 s. The mirror and a left
window cannot be told apart from head angle alone.

Still to confirm on a real phone (each is one config value if wrong):
1. Head **yaw** sign (`pose.yawRightSign`): turn your head right in Debug mode → yaw positive?
2. Blendshape eye direction matches the iris (Debug "Gaze" chart: iris x and blend x move together).
3. Gyroscope turn sign: on a real right turn, the turn rate is positive.
4. Assumption in A37/A38: when smiling or behind glasses, the iris may read "down" but the
   `eyeLookDown` blendshape does not (P7 clips).

Still failing, by phase: P3 — A02, A17, A20, B02, B06, D03 · P4 — B01, C01, C02, C04–C07, C15,
D01, D02, D09, E05–E11, F06 · P5 — B05, F01–F03.

## 5. Safety rules for every change

1. A fix that removes false alerts must not remove a real one. Every relaxation (T1, T2, T5, T7) has a "guard" case in group B.
2. Unknown always counts as risky: unknown speed = moving, unknown eyes ≠ open.
3. Thresholds can only be loosened within limits. Microsleep alarms never start later than 2.0 s (L3).
4. Synthetic traces test the **logic**. They cannot prove that MediaPipe sees a squint or a mask correctly. That is what the R cases are for.

## 6. Decisions needed from you

1. **Red light:** no distraction alerts at all while stopped? Or also a reminder the moment the car moves off with eyes still down (B05)? *Recommended: both.*
2. **Location:** make "use location" the suggested default during onboarding? It's the biggest single accuracy gain, and location never leaves the phone. *Recommended: yes.*
3. **Motion sensors:** OK to use the accelerometer and gyroscope? iPhone shows one more permission prompt. *Recommended: yes.*
4. **Low speed (5–25 km/h):** soft beep after 3.5 s instead of 2 s? *Recommended: yes.*
5. **Real recordings:** can you record about 20 short clips (parked or at a desk) for the R cases? I'll send a shot list. Videos stay on your computer, never in the repo.

## References

- Kircher, K. & Ahlström, C. (2009). *Issues related to the driver distraction detection algorithm AttenD.* (Basis for the attention buffer, T4.)
- NHTSA (2013). *Visual-Manual Driver Distraction Guidelines for In-Vehicle Electronic Devices.* (Single glances away from the road should stay ≤ 2 s.)
- MediaPipe Face Landmarker blendshapes (`eyeLookDown*`, `eyeLookIn*`, `eyeLookOut*`, `eyeSquint*`, `jawOpen`, …) — <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js>
