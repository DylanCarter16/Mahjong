import { useEffect, useMemo, useRef, useState } from 'react'
import { claimAnalysis, rankDiscards, readOpponents, type ClaimEval } from '../engine/analysis'
import type { PlayerView } from '../engine/game'
import { tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { TileView } from '../ui/TileView'
import type { FinishedInfo } from '../ui/useGame'
import { requestCoach, requestReview, type AnalysisResult } from './client'

const COOLDOWN_MS = 8_000
const SEAT_LABELS = ['You', 'South', 'West', 'North'] as const

/** Cache key: everything the coach's answer depends on. */
function viewKey(view: PlayerView): string {
  return JSON.stringify([view.concealed, view.melds, view.discards, view.wallCount, view.pendingDiscard])
}

function dangerLabel(score: number | undefined): { text: string; cls: string } {
  const s = score ?? 5
  if (s === 0) return { text: 'safe', cls: 'text-lime-300' }
  if (s <= 2) return { text: 'low', cls: 'text-lime-200/80' }
  if (s <= 4) return { text: 'med', cls: 'text-amber-300' }
  return { text: 'high', cls: 'text-rose-300' }
}

/** One rendering path for tiles (§5.3) — never a bare glyph character. */
function TileChip({ tile }: { tile: TileId }) {
  return (
    <span className="inline-flex w-5 shrink-0 align-middle">
      <TileView tile={tile} size="xs" />
    </span>
  )
}

function claimLabel(claim: ClaimEval['claim']): { text: string; tiles: TileId[] } {
  if (claim === 'win') return { text: 'Win 食糊', tiles: [] }
  if (claim === 'pung') return { text: 'Pung 碰', tiles: [] }
  if (claim === 'kong') return { text: 'Kong 槓', tiles: [] }
  return { text: 'Chow 上', tiles: claim.chow }
}

export function AnalysisPanel({
  view,
  finished,
  byoKey,
  roomCode,
  coachEnabled = true,
  aidsEnabled = true,
  claimAdvice = false,
}: {
  view: PlayerView
  /** Round-end disclosure (result + full log) — null while a round is live. */
  finished: FinishedInfo | null
  /** Optional bring-your-own key from Settings — memory only, never stored. */
  byoKey?: string
  /** Room code, forwarded for the per-room rate limit (§9). Solo omits it. */
  roomCode?: string
  /**
   * Host's "AI coach allowed" setting (§9): gates the MODEL calls only. When
   * false the launcher shows nothing about AI — and if aids are also off, this
   * component renders nothing at all rather than a present-but-dead button.
   */
  coachEnabled?: boolean
  /**
   * Beginner aids (personal toggle AND the room's house rule): gates the local
   * engine tables, which cost nothing and send no request. Deliberately a
   * SEPARATE flag from coachEnabled — either can be on without the other.
   */
  aidsEnabled?: boolean
  /**
   * Evaluate claim opportunities (pung/chow/kong) as well as discards.
   * Single-player only: a multiplayer claim window is 3–8s, too short for a
   * model round trip, so multiplayer leaves this off (both halves — the local
   * table would be fine, but the ask was explicitly solo-only).
   */
  claimAdvice?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const lastManualCall = useRef(0)
  const inFlight = useRef<{ key: string; ctl: AbortController } | null>(null)
  const cache = useRef(new Map<string, string>())
  /** What to re-run when the user taps "try again" after a failure. */
  const lastRun = useRef<'coach' | 'review' | null>(null)

  const myDiscardTurn = view.phase === 'discard' && view.turn === view.seat
  const roundOver = view.phase === 'finished' && finished !== null
  const key = viewKey(view)

  // The instant local layer: engine facts render at ~0ms; prose is a bonus.
  const facts = useMemo(() => {
    if (!open || !myDiscardTurn || !aidsEnabled) return null
    const ranked = rankDiscards(view).slice(0, 6)
    const reads = readOpponents(view)
    const threat = reads.reduce((a, b) => (b.threat > a.threat ? b : a))
    return { ranked, threat }
  }, [open, myDiscardTurn, aidsEnabled, view])

  // A claim I could make right now. Same "engine computes, model narrates"
  // split as the discard coach: shanten before/after is exact and instant.
  const claims = useMemo(() => {
    if (!claimAdvice || view.phase !== 'claims') return null
    const options = claimAnalysis(view)
    if (options.length === 0) return null
    const myMelds = view.melds[view.seat]
    return {
      options,
      tile: view.pendingDiscard!.tile,
      from: view.pendingDiscard!.from,
      /** Claiming always exposes a meld — this says whether that costs anything new. */
      concealedNow: myMelds.every((m) => m.concealed),
    }
  }, [claimAdvice, view])

  const claimable = claims !== null

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(
      () => setCooldown(Math.max(0, Math.ceil((lastManualCall.current + COOLDOWN_MS - Date.now()) / 1000))),
      500,
    )
    return () => clearInterval(t)
  }, [cooldown])

  /** A failed call bought nothing — don't also make the user wait out a cooldown. */
  const clearCooldown = () => {
    lastManualCall.current = 0
    setCooldown(0)
  }

  const runCoach = async (manual: boolean) => {
    const cached = cache.current.get(key)
    if (cached !== undefined) {
      setResult({ ok: true, text: cached })
      setStreamText(cached)
      return
    }
    if (inFlight.current?.key === key) return // single-flight per position
    inFlight.current?.ctl.abort()
    const ctl = new AbortController()
    inFlight.current = { key, ctl }
    lastRun.current = 'coach'
    if (manual) {
      lastManualCall.current = Date.now()
      setCooldown(COOLDOWN_MS / 1000)
    }
    setBusy(true)
    setResult(null)
    setStreamText('')
    const r = await requestCoach(view, {
      ...(byoKey ? { byoKey } : {}),
      ...(roomCode ? { roomCode } : {}),
      signal: ctl.signal,
      onDelta: setStreamText,
    })
    if (r.ok) cache.current.set(key, r.text)
    if (!(r.ok === false && r.error === 'cancelled')) setResult(r)
    if (r.ok === false && r.error !== 'cancelled') clearCooldown()
    setBusy(false)
  }

  // Prefetch: fire the coach as soon as it becomes my turn — or as soon as a
  // tile becomes claimable (solo) — but only while the panel is open
  // (deliberate: auto-firing every turn with the panel closed would burn the
  // shared rate limit for prose nobody is reading).
  useEffect(() => {
    if (!open || !coachEnabled) return
    if (!myDiscardTurn && !claimable) return
    void runCoach(false)
    return () => {
      // The moment passed (discard made, claim window closed): cancel a stale
      // in-flight request.
      if (inFlight.current?.key === key) inFlight.current.ctl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myDiscardTurn, claimable, key, coachEnabled])

  useEffect(() => () => inFlight.current?.ctl.abort(), [])

  const runReview = async () => {
    if (!finished || busy || Date.now() - lastManualCall.current < COOLDOWN_MS) return
    lastManualCall.current = Date.now()
    setCooldown(COOLDOWN_MS / 1000)
    setBusy(true)
    setResult(null)
    setStreamText('')
    inFlight.current?.ctl.abort()
    const ctl = new AbortController()
    inFlight.current = { key: 'review', ctl }
    lastRun.current = 'review'
    const r = await requestReview(finished.log, finished.result, {
      ...(byoKey ? { byoKey } : {}),
      ...(roomCode ? { roomCode } : {}),
      signal: ctl.signal,
      onDelta: setStreamText,
    })
    if (!(r.ok === false && r.error === 'cancelled')) setResult(r)
    if (r.ok === false && r.error !== 'cancelled') clearCooldown()
    setBusy(false)
  }

  const retry = () => {
    setResult(null)
    setStreamText('')
    if (lastRun.current === 'review') void runReview()
    else void runCoach(true)
  }

  // Nothing to offer: no model calls allowed AND no local tables allowed. A
  // launcher here would be a button that opens an empty panel (§B3).
  if (!coachEnabled && !aidsEnabled) return null

  const title = coachEnabled ? '✨ AI coach' : '🀄 Discard table'

  if (!open) {
    return (
      <button
        className="min-h-11 rounded-lg bg-emerald-800/80 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer"
        onClick={() => setOpen(true)}
      >
        {claimable ? `${title} — claim this tile?` : title}
      </button>
    )
  }

  const shownText = result?.ok ? result.text : streamText
  const failed = result != null && !result.ok
  const errorText =
    failed && lastRun.current === 'review'
      ? `Couldn't generate a review — ${(result as { error: string }).error}`
      : failed
        ? (result as { error: string }).error
        : ''

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-emerald-700 bg-emerald-950/80 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-emerald-50">{title}</h3>
        <button
          className="min-h-11 px-2 text-emerald-300 hover:text-white cursor-pointer"
          aria-label="Close the coach panel"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      {claims && aidsEnabled && (
        <div className="mt-2 rounded-lg border border-emerald-700/70 bg-emerald-900/50 p-2">
          <div className="flex flex-wrap items-center gap-1 text-xs text-emerald-200/90">
            <span>{SEAT_LABELS[claims.from]} discarded</span>
            <TileChip tile={claims.tile} />
            <span className="font-medium">{tileName(claims.tile)}</span>
            <span className="text-emerald-300/70">— worth claiming?</span>
          </div>
          <table className="mt-1.5 w-full text-xs">
            <thead>
              <tr className="text-left text-emerald-300/60">
                <th className="py-1 pr-2">claim</th>
                <th className="py-1 pr-2">shanten</th>
                <th className="py-1">verdict</th>
              </tr>
            </thead>
            <tbody>
              {claims.options.map((o, i) => {
                const l = claimLabel(o.claim)
                const wins = o.shantenAfter === -1
                const gain = o.shantenBefore - o.shantenAfter
                return (
                  <tr
                    key={i}
                    className={o.recommended ? 'font-bold text-amber-300' : 'text-emerald-100'}
                  >
                    <td className="flex flex-wrap items-center gap-1 py-0.5 pr-2">
                      {l.text}
                      {l.tiles.map((t, j) => (
                        <TileChip key={j} tile={t} />
                      ))}
                    </td>
                    <td className="py-0.5 pr-2 font-mono">
                      {o.shantenBefore} → {wins ? 'win' : o.shantenAfter}
                    </td>
                    <td className="py-0.5">
                      {wins
                        ? 'takes the hand'
                        : gain > 0
                          ? `${gain} step${gain > 1 ? 's' : ''} closer`
                          : gain === 0
                            ? 'no closer to ready'
                            : 'moves you backwards'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-[0.65rem] text-emerald-400/60">
            Claiming exposes the set:{' '}
            {claims.concealedNow
              ? 'your hand stops being concealed, and everyone can read part of it.'
              : 'you already have an exposed set, so the cost is the extra information only.'}
          </p>
        </div>
      )}

      {facts && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-emerald-300/60">
                <th className="py-1 pr-2">discard</th>
                <th className="py-1 pr-2">shanten</th>
                <th className="py-1 pr-2">live tiles</th>
                {facts.threat.threat >= 2 && <th className="py-1">vs {SEAT_LABELS[facts.threat.seat]}</th>}
              </tr>
            </thead>
            <tbody>
              {facts.ranked.map((r, i) => {
                const d = dangerLabel(r.dangerByOpponent[facts.threat.seat])
                return (
                  <tr key={r.tile} className={i === 0 ? 'font-bold text-amber-300' : 'text-emerald-100'}>
                    <td className="flex items-center gap-1 py-0.5 pr-2">
                      <TileChip tile={r.tile} /> {tileName(r.tile)}
                    </td>
                    <td className="py-0.5 pr-2 font-mono">{r.shantenAfter === -1 ? 'win' : r.shantenAfter}</td>
                    <td className="py-0.5 pr-2 font-mono">{r.ukeire}</td>
                    {facts.threat.threat >= 2 && <td className={`py-0.5 ${d.cls}`}>{d.text}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {coachEnabled ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Calm treatment (not amber): the amber recommended row above is the
              signal that should own the one accent, not this button. */}
          <button
            disabled={busy || cooldown > 0 || roundOver}
            className="min-h-11 rounded-lg border border-emerald-600 bg-emerald-700 px-4 py-2 font-semibold text-emerald-50 hover:bg-emerald-600 disabled:opacity-40 cursor-pointer"
            onClick={() => void runCoach(true)}
          >
            {claimable ? 'Should I claim it?' : 'Analyse my hand'}
          </button>
          <button
            disabled={busy || cooldown > 0 || !roundOver}
            className="min-h-11 rounded-lg bg-sky-400 px-4 py-2 font-semibold text-sky-950 hover:bg-sky-300 disabled:opacity-40 cursor-pointer"
            onClick={() => void runReview()}
            title={roundOver ? '' : 'Available when the round ends'}
          >
            Review that round
          </button>
          {cooldown > 0 && <span className="self-center text-xs text-emerald-300/70">wait {cooldown}s</span>}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-emerald-800 bg-emerald-900/40 p-2 text-xs text-emerald-300/70">
          The AI coach is turned off for this room. The exact tables above are local and always available.
        </p>
      )}

      {/* One stable, min-height container for every coach-output state, so the
          panel doesn't jump when "Thinking…" is replaced by the answer. Every
          request settles — the client times out — so this can never be a
          spinner that runs forever. */}
      {coachEnabled && (busy || shownText || failed) && (
        <div
          className={`mt-3 min-h-[4.5rem] whitespace-pre-wrap rounded-lg border p-3 ${
            failed
              ? 'border-rose-500 bg-rose-500/15 text-rose-100'
              : 'border-emerald-600 bg-emerald-900/70 text-emerald-50'
          }`}
          aria-live="polite"
        >
          {busy && !shownText && <span className="animate-pulse text-emerald-200">Thinking…</span>}
          {failed && (
            <>
              <p>{errorText}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="min-h-11 rounded-lg bg-rose-100 px-3 py-1.5 font-semibold text-rose-950 hover:bg-white cursor-pointer"
                  onClick={retry}
                >
                  Try again
                </button>
                <button
                  className="min-h-11 rounded-lg px-3 py-1.5 underline cursor-pointer"
                  onClick={() => setResult(null)}
                >
                  dismiss
                </button>
              </div>
            </>
          )}
          {!failed && shownText && (
            <>
              {shownText}
              {result?.ok && result.model && (
                <div className="mt-2 text-right text-[0.65rem] text-emerald-400/60">{result.model}</div>
              )}
            </>
          )}
        </div>
      )}
      <p className="mt-2 text-[0.65rem] text-emerald-400/50">
        Tables = exact engine analysis (instant, local).
        {coachEnabled ? ` Prose = model narration${byoKey ? ', using your key' : ''}.` : ''}
      </p>
    </div>
  )
}
