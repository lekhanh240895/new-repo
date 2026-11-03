# P8 — Real-drive check

P7 confirmed the head and eye directions on a real face. Two sensors can only be checked
in a moving car:

- **GPS speed.** With "Use location" on, the app stays quiet when the car is stopped
  (decision 1). Does the phone really give a speed while you drive, and does no alarm start
  at a red light?
- **The turn sensor (gyroscope).** Looking into a turn is driving, not a distraction (T2).
  That needs the turn direction right. Its sign is a guess from the W3C spec
  (`motion.turnRightSign`), like the head signs were before P7.

The app answers both by itself after the trip: the **trip summary** has a "Drive check"
section. The GPS heading (the direction of travel) turns clockwise in a right turn, however
the phone is mounted, so each turn the gyroscope sees is compared with it.

## Safety first

- **Do everything before you drive and after you park.** Do not touch the phone while
  driving. Do not act out any test while driving: just drive normally.
- Drive as you always do. The check needs ordinary corners, not special moves.
- Only on roads you know, in daylight, with the phone in its mount.

## Steps

1. **Parked:** put the phone in its mount and open the app (the GitHub Pages link).
2. On the start screen, keep **"Use location…"** ticked and allow location. On iPhone, also
   allow motion access when asked.
3. Tap **Start trip**, look at the road for the calibration, then drive.
4. Drive **at least 10 minutes** with **5 or more corners** (left and right; roundabouts and
   junctions are fine) and at least one stop (a red light).
5. **Park**, then tap the screen and **End trip**.
6. Read **Drive check** on the summary:

| Line | Good | What to do otherwise |
| --- | --- | --- |
| GPS speed | "OK" | "weak" or "none": check location permission; send the log |
| Stopped | "No alarm started while the car was stopped" | Save the log and send it |
| Turn sensor | "OK (n of n turns match)" | "reversed": save the log and send it. "not enough turns": drive more corners |

7. To send it: tap **Save drive log** and send the `.json` file. It holds only numbers twice a
   second (speed, direction of travel, turn rate, head angles, alarms): **no position, no
   images**.

## Reading a saved log on a computer

```bash
npm run drive-check -- ~/Downloads/biomonitor-drive-2026-11-03.json
```

Prints the result and a table of every turn (gyroscope, GPS heading change, head yaw), and
writes `replay-out/DRIVE_REPORT.md` (git-ignored).

If the turn sensor is reversed, the fix is one value: `motion.turnRightSign` in
`src/core/config.ts`.
