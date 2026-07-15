import { useEffect, useRef, useState } from 'react'
import type { GameState, PlayerView } from '../engine/game'
import { analyse, type AnalysisResult } from './client'
import { handAnalysisPrompt, postRoundPrompt } from './prompts'
import { serialiseLog, serialisePlayerView } from './serialise'

const COOLDOWN_MS = 8_000

export function AnalysisPanel({ view, state }: { view: PlayerView; state: GameState }) {
  // The key lives here — component state only. Never rendered, logged,
  // persisted, or sent anywhere except api.anthropic.com.
  const [apiKey, setApiKey] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const lastCall = useRef(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(
      () => setCooldown(Math.max(0, Math.ceil((lastCall.current + COOLDOWN_MS - Date.now()) / 1000))),
      500,
    )
    return () => clearInterval(t)
  }, [cooldown])

  const run = async (prompt: string) => {
    if (busy || Date.now() - lastCall.current < COOLDOWN_MS) return
    lastCall.current = Date.now()
    setCooldown(COOLDOWN_MS / 1000)
    setBusy(true)
    setResult(null)
    setResult(await analyse(apiKey.trim(), prompt))
    setBusy(false)
  }

  const canCall = apiKey.trim().length > 10 && !busy && cooldown <= 0
  const roundOver = state.phase === 'finished'

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

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-emerald-700 bg-emerald-950/80 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-emerald-50">✨ AI coach</h3>
        <button className="text-emerald-300 hover:text-white cursor-pointer" onClick={() => setOpen(false)}>✕</button>
      </div>
      <p className="mt-1 text-xs text-emerald-300/70">
        Bring your own Anthropic API key. It stays in memory for this tab only — never saved, never sent
        anywhere but the Anthropic API.
      </p>
      <input
        type="password"
        autoComplete="off"
        placeholder="sk-ant-…"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className="mt-2 w-full rounded-lg border border-emerald-700 bg-emerald-900 px-3 py-2 font-mono text-emerald-50 placeholder:text-emerald-500"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={!canCall || roundOver}
          className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40 cursor-pointer"
          onClick={() => run(handAnalysisPrompt(serialisePlayerView(view)))}
        >
          Analyse my hand
        </button>
        <button
          disabled={!canCall || !roundOver}
          className="rounded-lg bg-sky-400 px-4 py-2 font-semibold text-sky-950 hover:bg-sky-300 disabled:opacity-40 cursor-pointer"
          onClick={() => run(postRoundPrompt(serialiseLog(state.log, state.result)))}
          title={roundOver ? '' : 'Available when the round ends'}
        >
          Review that round
        </button>
        {cooldown > 0 && <span className="self-center text-xs text-emerald-300/70">wait {cooldown}s</span>}
      </div>
      {busy && <p className="mt-3 animate-pulse text-emerald-200">Thinking…</p>}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-rose-500 bg-rose-500/15 p-3 text-rose-100">
          {result.error}
          <button className="ml-2 underline cursor-pointer" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}
      {result?.ok && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-emerald-600 bg-emerald-900/70 p-3 text-emerald-50">
          {result.text}
          <div className="mt-2 text-right text-[0.65rem] text-emerald-400/60">{result.model}</div>
        </div>
      )}
    </div>
  )
}
