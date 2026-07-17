// The claim-window countdown (§7): a thin depleting ring, legible at a glance
// without being stressful — never a big pulsing number. It wraps the claim
// buttons. Latency only affects whether your claim lands, not whether you win
// a contest (§5.1), so this is a gentle "soon" cue, not a hard guarantee; the
// server is the authority on when the window actually closes.
//
// Accessibility: honours prefers-reduced-motion. A moving/pulsing timer is
// exactly the kind of thing that's hostile to some people (§7), so with
// reduced motion we drop the sweep animation and show a calm static ring
// plus an aria-live seconds count that updates once per second.

import { useEffect, useRef, useState } from 'react'

const RADIUS = 22
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function ClaimCountdown({
  durationMs,
  /** Restart key: changing it (e.g. a new pending discard) resets the ring. */
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

  const fraction = durationMs > 0 ? remaining / durationMs : 0
  const seconds = Math.ceil(remaining / 1000)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        className="pointer-events-none absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)]"
        viewBox="0 0 48 48"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-800/50" />
        <circle
          cx="24"
          cy="24"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-amber-300"
          transform="rotate(-90 24 24)"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      {children}
      {/* Screen-reader + reduced-motion seconds readout; visually muted. */}
      <span className="sr-only" aria-live="polite">
        {seconds} second{seconds === 1 ? '' : 's'} to claim
      </span>
    </div>
  )
}
