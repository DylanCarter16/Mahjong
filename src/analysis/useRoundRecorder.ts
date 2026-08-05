// Bank a graded record of every round you finish, whether or not you ask for a
// review.
//
// The patterns view is only worth anything if it has rounds to look across, and
// tying that to "did you tap Review" would mean the cross-round layer only ever
// saw the games you were already thinking hard about — the opposite of the ones
// where a habit shows. The scan is pure and local (no key, no request), so
// running it at every round end costs nothing but a few milliseconds.

import { useEffect, useRef } from 'react'
import { scanRound } from '../engine/review'
import type { PlayerView } from '../engine/game'
import { appendRound } from '../lessons/persistence'
import type { FinishedInfo } from '../ui/useGame'
import { recordRound } from './leaks'

const today = () => new Date().toISOString().slice(0, 10)

export function useRoundRecorder(view: PlayerView | null, finished: FinishedInfo | null): void {
  // Identity of the round already banked. Keyed on the log object the runner
  // sent, so a re-render, a StrictMode double-effect, or reopening the panel
  // cannot double-count a round.
  const banked = useRef<unknown>(null)

  useEffect(() => {
    if (!view || !finished || banked.current === finished.log) return
    banked.current = finished.log
    try {
      const scan = scanRound({
        seat: view.seat,
        log: finished.log,
        result: finished.result,
        roundWind: view.roundWind,
        seatWinds: view.seatWinds,
        faanMinimum: view.faanMinimum,
        snapshots: finished.snapshots,
      })
      // A round with nothing graded (joined late, no hands captured) would add
      // a row of zeroes that quietly dilutes every rate above it.
      if (scan.moments.length === 0) return
      appendRound(window.localStorage, recordRound(scan, today()))
    } catch {
      // Recording patterns is a side benefit; it must never take down the table.
    }
  }, [view, finished])
}
