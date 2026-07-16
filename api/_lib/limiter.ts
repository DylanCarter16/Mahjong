// Fixed-window in-memory rate limiter. Limitation (documented in README):
// state is per function instance and resets on cold start — fine for a hobby
// deployment, swap for a KV-backed limiter if it ever matters.

export interface LimiterOptions {
  perMinute: number
  perDay: number
  now?: () => number
}

interface Window {
  minuteStart: number
  minuteCount: number
  dayStart: number
  dayCount: number
}

export interface Limiter {
  /** Returns retry-after seconds when limited, or null when allowed. */
  check(key: string): number | null
}

export function makeLimiter({ perMinute, perDay, now = Date.now }: LimiterOptions): Limiter {
  const windows = new Map<string, Window>()
  return {
    check(key: string): number | null {
      const t = now()
      let w = windows.get(key)
      if (!w) {
        w = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0 }
        windows.set(key, w)
      }
      if (t - w.minuteStart >= 60_000) {
        w.minuteStart = t
        w.minuteCount = 0
      }
      if (t - w.dayStart >= 86_400_000) {
        w.dayStart = t
        w.dayCount = 0
      }
      if (w.dayCount >= perDay) return Math.ceil((w.dayStart + 86_400_000 - t) / 1000)
      if (w.minuteCount >= perMinute) return Math.ceil((w.minuteStart + 60_000 - t) / 1000)
      w.minuteCount++
      w.dayCount++
      // Bound memory: drop stale entries occasionally.
      if (windows.size > 5_000) {
        for (const [k, v] of windows) if (t - v.dayStart >= 86_400_000) windows.delete(k)
      }
      return null
    },
  }
}

/** Same-origin check: the Origin header's host must match the Host header. */
export function sameOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean {
  if (!originHeader || !hostHeader) return false
  try {
    const origin = new URL(originHeader)
    if (origin.host === hostHeader) return true
    // Local dev: vite (client) and the functions emulator may sit on
    // different localhost ports.
    const localhost = (h: string) => h.startsWith('localhost') || h.startsWith('127.0.0.1')
    return localhost(origin.host) && localhost(hostHeader)
  } catch {
    return false
  }
}
