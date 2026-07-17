// Injectable clock (spec §3). RoomRunner never calls setTimeout directly:
// claim windows and turn timers are untestable against the real timer, and
// the Phase 2 server must re-arm deadlines after a Durable Object eviction,
// which only works if time is a dependency rather than an ambient global.

export interface TimerHandle {
  /** Opaque token; hand it back to Clock.clearTimeout. */
  readonly _h: unknown
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => ({ _h: globalThis.setTimeout(fn, ms) }),
  clearTimeout: (h) => globalThis.clearTimeout(h._h as ReturnType<typeof globalThis.setTimeout>),
}

interface PendingTimer {
  id: number
  at: number
  fn: () => void
}

/**
 * Deterministic clock for tests. Timers fire only inside advance()/runAll(),
 * in deadline order (ties break by scheduling order), and a timer callback
 * may schedule further timers that fire within the same advance() if due.
 */
export class FakeClock implements Clock {
  private t: number
  private seq = 0
  private timers: PendingTimer[] = []

  constructor(start = 0) {
    this.t = start
  }

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn })
    return { _h: id }
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((x) => x.id !== handle._h)
  }

  /** Number of armed timers — lets tests assert nothing was leaked. */
  get pending(): number {
    return this.timers.length
  }

  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x.id !== due.id)
      this.t = Math.max(this.t, due.at)
      due.fn()
    }
    this.t = target
  }

  /** Fire timers (including newly scheduled ones) until none remain. */
  runAll(maxTicks = 100_000): void {
    for (let i = 0; i < maxTicks; i++) {
      const next = [...this.timers].sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!next) return
      this.timers = this.timers.filter((x) => x.id !== next.id)
      this.t = Math.max(this.t, next.at)
      next.fn()
    }
    throw new Error(`FakeClock.runAll: timers still pending after ${maxTicks} ticks`)
  }
}
