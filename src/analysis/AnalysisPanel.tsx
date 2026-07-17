import { useEffect, useMemo, useRef, useState } from 'react'
import { CloseIcon, SparkleIcon } from '../ui/icons'
import { claimAnalysis, rankDiscards, readOpponents, type ClaimEval } from '../engine/analysis'
import type { GameState, PlayerView } from '../engine/game'
import { glyph, tileName } from '../engine/tiles'
import { requestCoach, requestReview, type AnalysisResult } from './client'

const COOLDOWN_MS = 8_000
const SEAT_LABELS = ['You', 'South', 'West', 'North'] as const

/** Cache key: everything the coach's answer depends on. */
function viewKey(view: PlayerView): string {
  return JSON.stringify([view.concealed, view.melds, view.discards, view.wallCount, view.pendingDiscard])
}

function dangerLabel(score: number | undefined): { text: string; cls: string } {
  const s = score ?? 5
  if (s === 0) return { text: 'safe', cls: 'text-safe' }
  if (s <= 2) return { text: 'low', cls: 'text-safe/80' }
  if (s <= 4) return { text: 'med', cls: 'text-consider' }
  return { text: 'high', cls: 'text-danger' }
}

export function AnalysisPanel({ view, state, byoKey }: {
  view: PlayerView
  state: GameState
  /** Optional bring-your-own key from Settings — memory only, never stored. */
  byoKey?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const lastManualCall = useRef(0)
  const inFlight = useRef<{ key: string; ctl: AbortController } | null>(null)
  const cache = useRef(new Map<string, string>())

  const myDiscardTurn = view.phase === 'discard' && view.turn === view.seat
  const roundOver = state.phase === 'finished'
  const key = viewKey(view)

  // The instant local layer: engine facts render at ~0ms; prose is a bonus.
  const facts = useMemo(() => {
    if (!open) return null
    if (myDiscardTurn) {
      const ranked = rankDiscards(view).slice(0, 6)
      const reads = readOpponents(view)
      const threat = reads.reduce((a, b) => (b.threat > a.threat ? b : a))
      return { kind: 'discard' as const, ranked, threat }
    }
    // Claim decision: someone discarded and we could take it.
    const claims = claimAnalysis(view)
    if (claims.length > 0 && view.pendingDiscard) {
      return { kind: 'claim' as const, claims, tile: view.pendingDiscard.tile }
    }
    return null
  }, [open, myDiscardTurn, view])

  const decisionMoment = myDiscardTurn || facts?.kind === 'claim'

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(
      () => setCooldown(Math.max(0, Math.ceil((lastManualCall.current + COOLDOWN_MS - Date.now()) / 1000))),
      500,
    )
    return () => clearInterval(t)
  }, [cooldown])

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
    if (manual) {
      lastManualCall.current = Date.now()
      setCooldown(COOLDOWN_MS / 1000)
    }
    setBusy(true)
    setResult(null)
    setStreamText('')
    const r = await requestCoach(view, {
      ...(byoKey ? { byoKey } : {}),
      signal: ctl.signal,
      onDelta: setStreamText,
    })
    if (r.ok) cache.current.set(key, r.text)
    if (!(r.ok === false && r.error === 'cancelled')) setResult(r)
    setBusy(false)
  }

  // Prefetch: fire the coach the moment a decision arrives (my discard turn
  // OR a claimable tile on the table) — but only while the panel is open
  // (auto-firing with the panel closed would burn the rate limit unseen).
  useEffect(() => {
    if (!open || !decisionMoment) return
    void runCoach(false)
    return () => {
      // The moment passed: cancel a stale in-flight request.
      if (inFlight.current?.key === key) inFlight.current.ctl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, decisionMoment, key])

  useEffect(() => () => inFlight.current?.ctl.abort(), [])

  const runReview = async () => {
    if (busy || Date.now() - lastManualCall.current < COOLDOWN_MS) return
    lastManualCall.current = Date.now()
    setCooldown(COOLDOWN_MS / 1000)
    setBusy(true)
    setResult(null)
    setStreamText('')
    inFlight.current?.ctl.abort()
    const ctl = new AbortController()
    inFlight.current = { key: 'review', ctl }
    const r = await requestReview(state.log, state.result, {
      ...(byoKey ? { byoKey } : {}),
      signal: ctl.signal,
      onDelta: setStreamText,
    })
    if (!(r.ok === false && r.error === 'cancelled')) setResult(r)
    setBusy(false)
  }

  if (!open) {
    return (
      <button
        className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-felt-light/60 px-3 py-1.5 text-sm text-parchment transition-colors duration-(--duration-ui) hover:bg-felt-light"
        onClick={() => setOpen(true)}
      >
        <SparkleIcon /> AI coach
      </button>
    )
  }

  const shownText = result?.ok ? result.text : streamText

  return (
    <div className="fixed right-0 top-0 z-20 h-full w-[22rem] max-w-[92vw] overflow-y-auto border-l border-felt-line bg-felt-deep/95 p-4 text-sm shadow-panel backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-serif font-semibold text-parchment">
          <SparkleIcon className="h-4 w-4 text-accent" /> AI coach
        </h3>
        <button className="cursor-pointer text-parchment-dim hover:text-parchment" onClick={() => setOpen(false)} aria-label="close coach">
          <CloseIcon />
        </button>
      </div>

      {facts?.kind === 'claim' && (
        <div className="mt-2 rounded-lg border border-accent/40 bg-felt/60 p-2 text-xs">
          <p className="mb-1 font-semibold text-parchment">
            {glyph(facts.tile)} {tileName(facts.tile)} is on the table — claim it?
          </p>
          {facts.claims.map((c: ClaimEval, i: number) => (
            <p key={i} className={c.recommended ? 'text-safe' : 'text-parchment-dim'}>
              {c.claim === 'win'
                ? 'WIN'
                : c.claim === 'pung'
                  ? 'Pung'
                  : c.claim === 'kong'
                    ? 'Kong'
                    : `Chow (${c.claim.chow.map(glyph).join('')})`}
              {' — '}
              {c.shantenAfter === -1
                ? 'wins the hand!'
                : `shanten ${c.shantenBefore} → ${c.shantenAfter}${c.recommended ? '' : ' (no progress — passing keeps you concealed)'}`}
            </p>
          ))}
        </div>
      )}

      {facts?.kind === 'discard' && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-parchment-dim">
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
                  <tr key={r.tile} className={i === 0 ? 'font-bold text-consider' : 'text-parchment'}>
                    <td className="py-0.5 pr-2">
                      {glyph(r.tile)} {tileName(r.tile)}
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={busy || cooldown > 0 || roundOver}
          className="cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110 disabled:opacity-40"
          onClick={() => void runCoach(true)}
        >
          Analyse my hand
        </button>
        <button
          disabled={busy || cooldown > 0 || !roundOver}
          className="cursor-pointer rounded-lg bg-ivory px-4 py-2 font-semibold text-ink transition-colors duration-(--duration-ui) hover:bg-ivory-bright disabled:opacity-40"
          onClick={() => void runReview()}
          title={roundOver ? '' : 'Available when the round ends'}
        >
          Review that round
        </button>
        {cooldown > 0 && <span className="tabular self-center text-xs text-parchment-dim">wait {cooldown}s</span>}
      </div>

      {busy && !shownText && <p className="mt-3 animate-pulse text-parchment-dim">Thinking…</p>}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-danger bg-danger/15 p-3 text-parchment">
          {result.error}
          <button className="ml-2 underline cursor-pointer" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}
      {shownText && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-felt-line bg-felt/70 p-3 text-parchment">
          {shownText}
          {result?.ok && result.model && (
            <div className="mt-2 text-right text-[0.65rem] text-parchment-dim/70">{result.model}</div>
          )}
        </div>
      )}
      <p className="mt-2 text-[0.65rem] text-parchment-dim/70">
        Table = exact engine analysis (instant, local). Prose = model narration{byoKey ? ', using your key' : ''}.
      </p>
    </div>
  )
}
