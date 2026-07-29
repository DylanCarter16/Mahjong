// The claim-window countdown (§7): a thin depleting bar laid out BENEATH the
// claim buttons — never an overlay. The buttons keep their exact position and
// size for the whole window, so a tap in the last half-second lands where the
// user aimed; the bar only ever changes width, never reflows the row above it.
// Latency only affects whether your claim lands, not whether you win a contest
// (§5.1), so this is a gentle "soon" cue — the server is the real authority.
//
// Accessibility: honours prefers-reduced-motion. With reduced motion we drop
// the smooth sweep (the bar steps once per second instead) and surface a visible
// numeric seconds count, plus an aria-live readout for screen readers.

import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './motion'

export function ClaimCountdown({
  durationMs,
  /** Restart key: changing it (e.g. a new pending discard) resets the bar. */
  resetKey,
  children,
}: {
  durationMs: number
  resetKey: string | number
  children: React.ReactNode
}) {
  const reduced = prefersReducedMotion()
  const [remaining, setRemaining] = useState(durationMs)
  const startRef = useRef(0)

  useEffect(() => {
    startRef.current = Date.now()
    setRemaining(durationMs)
    if (reduced) {
      // Step once per second — no smooth sweep, no pulse.
      const id = setInterval(() => {
        const left = Math.max(0, durationMs - (Date.now() - startRef.current))
        setRemaining(left)
        if (left <= 0) clearInterval(id)
      }, 1000)
      return () => clearInterval(id)
    }
    let raf = 0
    const tick = () => {
      const left = Math.max(0, durationMs - (Date.now() - startRef.current))
      setRemaining(left)
      if (left > 0) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [durationMs, resetKey, reduced])

  const fraction = durationMs > 0 ? Math.max(0, Math.min(1, remaining / durationMs)) : 0
  const seconds = Math.ceil(remaining / 1000)

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {children}
      {/* Depleting bar UNDER the buttons — only its width animates, so the row
          above never moves or resizes. */}
      <div className="flex w-full max-w-xs items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-emerald-800/50"
          role="timer"
          aria-hidden={reduced ? undefined : true}
        >
          <div
            className="h-full rounded-full bg-amber-300"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        {reduced && (
          <span className="w-6 text-right text-xs tabular-nums text-amber-200/90">{seconds}s</span>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {seconds} second{seconds === 1 ? '' : 's'} to claim
      </span>
    </div>
  )
}
