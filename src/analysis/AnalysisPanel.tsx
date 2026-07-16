import { useEffect, useMemo, useRef, useState } from 'react'
import { rankDiscards, readOpponents } from '../engine/analysis'
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
  if (s === 0) return { text: 'safe', cls: 'text-lime-300' }
  if (s <= 2) return { text: 'low', cls: 'text-lime-200/80' }
  if (s <= 4) return { text: 'med', cls: 'text-amber-300' }
  return { text: 'high', cls: 'text-rose-300' }
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
    if (!open || !myDiscardTurn) return null
    const ranked = rankDiscards(view).slice(0, 6)
    const reads = readOpponents(view)
    const threat = reads.reduce((a, b) => (b.threat > a.threat ? b : a))
    return { ranked, threat }
  }, [open, myDiscardTurn, view])

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

  // Prefetch: fire the coach as soon as it becomes my turn — but only while
  // the panel is open (deliberate: auto-firing every turn with the panel
  // closed would burn the shared rate limit for prose nobody is reading).
  useEffect(() => {
    if (!open || !myDiscardTurn) return
    void runCoach(false)
    return () => {
      // My turn ended (discard happened): cancel a stale in-flight request.
      if (inFlight.current?.key === key) inFlight.current.ctl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myDiscardTurn, key])

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
        className="rounded-lg bg-emerald-800/80 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer"
        onClick={() => setOpen(true)}
      >
        ✨ AI coach
      </button>
    )
  }

  const shownText = result?.ok ? result.text : streamText

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-emerald-700 bg-emerald-950/80 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-emerald-50">✨ AI coach</h3>
        <button className="text-emerald-300 hover:text-white cursor-pointer" onClick={() => setOpen(false)}>✕</button>
      </div>

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
          className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40 cursor-pointer"
          onClick={() => void runCoach(true)}
        >
          Analyse my hand
        </button>
        <button
          disabled={busy || cooldown > 0 || !roundOver}
          className="rounded-lg bg-sky-400 px-4 py-2 font-semibold text-sky-950 hover:bg-sky-300 disabled:opacity-40 cursor-pointer"
          onClick={() => void runReview()}
          title={roundOver ? '' : 'Available when the round ends'}
        >
          Review that round
        </button>
        {cooldown > 0 && <span className="self-center text-xs text-emerald-300/70">wait {cooldown}s</span>}
      </div>

      {busy && !shownText && <p className="mt-3 animate-pulse text-emerald-200">Thinking…</p>}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-rose-500 bg-rose-500/15 p-3 text-rose-100">
          {result.error}
          <button className="ml-2 underline cursor-pointer" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}
      {shownText && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-emerald-600 bg-emerald-900/70 p-3 text-emerald-50">
          {shownText}
          {result?.ok && result.model && (
            <div className="mt-2 text-right text-[0.65rem] text-emerald-400/60">{result.model}</div>
          )}
        </div>
      )}
      <p className="mt-2 text-[0.65rem] text-emerald-400/50">
        Table = exact engine analysis (instant, local). Prose = model narration{byoKey ? ', using your key' : ''}.
      </p>
    </div>
  )
}
