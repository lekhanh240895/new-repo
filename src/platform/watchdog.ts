/**
 * Watchdog (SPEC §12 F20): if no processed frame arrives for `stallMs`,
 * report a stall once. `check()` is separate from the timer so it can be tested.
 *
 * Before the first frame after (re)arming, the limit is `startupMs` instead:
 * a GPU model's first frame can take seconds while shaders compile, and
 * treating that as a stall restarts the engine forever.
 */

export interface Watchdog {
  /** Call on every processed frame. */
  kick(now: number): void;
  /** Returns true when a new stall is detected (once per stall). */
  check(now: number): boolean;
  /** Start watching from `now`; the first frame gets the longer start-up limit. */
  arm(now: number): void;
  start(onStall: () => void, now?: () => number): void;
  stop(): void;
}

export function createWatchdog(stallMs: number, startupMs: number = stallMs): Watchdog {
  let armedAt: number | null = null
  let last: number | null = null
  let stalled = false
  let timer: ReturnType<typeof setInterval> | null = null

  const dog: Watchdog = {
    kick(now) {
      last = now
      stalled = false
    },
    check(now) {
      if (armedAt === null || stalled) return false
      const overdue = last === null ? now - armedAt >= startupMs : now - last >= stallMs
      if (!overdue) return false
      stalled = true
      return true
    },
    arm(now) {
      armedAt = now
      last = null
      stalled = false
    },
    start(onStall, now = () => performance.now()) {
      dog.stop()
      dog.arm(now())
      timer = setInterval(() => {
        if (dog.check(now())) onStall()
      }, Math.max(50, stallMs / 4))
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
      armedAt = null
    },
  }
  return dog
}
