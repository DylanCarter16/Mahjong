// Client for the /api proxy. No prompts are built here and no key is
// required — the server holds the key and constructs all prompt text. An
// optional bring-your-own key (Settings) is forwarded as a header, kept in
// memory only, and skips the shared rate limit.

import type { Action, PlayerView, RoundResult } from '../engine/game'
import type { HandSnapshot, Moment, RoundScan } from '../engine/review'
import type { Seat, Wind } from '../engine/types'
import { cleanCoachText } from './coachText'

/**
 * The engine-graded shortlist the server built the prompt from, returned with
 * the answer so the panel renders exactly the moments the model was asked
 * about. Absent when the review fell back to the whole-log prompt.
 */
export interface ReviewMeta {
  summary: string
  tally: RoundScan['tally']
  degraded: string[]
  moments: Omit<Moment, 'weight'>[]
}

export type AnalysisResult =
  | { ok: true; text: string; model?: string; review?: ReviewMeta }
  | { ok: false; error: string; rateLimited?: boolean; timedOut?: boolean }

/** Strip markdown code fences if the model wrapped its answer in them. */
export function stripFences(text: string): string {
  const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : text.trim()
}

export interface RequestOptions {
  byoKey?: string
  /** Room code, forwarded for the per-room rate-limit bucket (§9). */
  roomCode?: string
  signal?: AbortSignal
  /** Streaming callback; receives the full accumulated text on each delta. */
  onDelta?: (fullText: string) => void
  /** Hard ceiling on the whole round trip. See DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Client-side ceilings. `fetch` never times out on its own, so without these a
 * proxy (or platform) that stalls leaves the panel spinning forever — that was
 * the "review never returns" bug. Each ceiling sits just ABOVE the matching
 * server budget (api/_src/*.ts `UPSTREAM_TIMEOUT_MS` + `maxDuration`) so the
 * server's own clean error wins the race when it can produce one; this is the
 * backstop for when the platform kills the function without answering.
 *
 * The COACH ceiling is deliberately short: it runs while you are sitting there
 * waiting to play, so 20 seconds is the whole patience budget — past that,
 * failing with a retry beats a spinner. The panel counts the seconds out loud
 * so the cut-off is legible rather than mysterious.
 *
 * The REVIEW keeps a longer one. It is a different call — ~700 tokens of prose
 * over a whole round, read after the hand is over, with nobody waiting on a
 * turn — and cutting it at 20s is what made it fail in the first place.
 */
export const COACH_TIMEOUT_MS = 20_000
export const REVIEW_TIMEOUT_MS = 65_000
const DEFAULT_TIMEOUT_MS = COACH_TIMEOUT_MS

export const requestCoach = (view: PlayerView, opts: RequestOptions = {}) =>
  post('/api/coach', { view }, { timeoutMs: COACH_TIMEOUT_MS, ...opts })

/**
 * Extra context that lets the SERVER run the decision-point scanner instead of
 * handing the model a raw log. Optional: without it the review still works, it
 * just falls back to the old whole-log prompt.
 *
 * `snapshots` are this player's own hands from their own view stream — nothing
 * hidden, and nothing the server didn't send them in the first place.
 */
export interface ReviewScanInput {
  seat: Seat
  roundWind: Wind
  seatWinds: Record<Seat, Wind>
  faanMinimum: number
  snapshots: HandSnapshot[]
}

export interface ReviewRequest {
  log: Action[]
  result: RoundResult | null
  scan?: ReviewScanInput
}

export const requestReview = (req: ReviewRequest, opts: RequestOptions = {}) =>
  post('/api/review', req, { timeoutMs: REVIEW_TIMEOUT_MS, ...opts })

/**
 * One AbortController fed by both the caller's signal and our own timer, so we
 * can tell "the user navigated away" (cancelled — stay silent) from "nothing
 * came back in time" (a real error the panel must show with a retry).
 * Deliberately hand-rolled rather than `AbortSignal.any`/`AbortSignal.timeout`,
 * which older mobile Safari does not have.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctl = new AbortController()
  const state = { timedOut: false }
  const onAbort = () => ctl.abort()
  if (signal) {
    if (signal.aborted) ctl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => {
    state.timedOut = true
    ctl.abort()
  }, ms)
  return {
    signal: ctl.signal,
    state,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function post(path: string, body: unknown, opts: RequestOptions): Promise<AnalysisResult> {
  const { byoKey, roomCode, signal, onDelta, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const guard = withTimeout(signal, timeoutMs)
  try {
    // One JSON response, no client-side streaming. Server-side SSE streaming
    // crashes Vercel's function runtime (FUNCTION_INVOCATION_FAILED, before any
    // model call), so we use the plain response path — which is reliable. The
    // coach still streams from Anthropic ON THE SERVER; the client just receives
    // the whole answer at once, behind the existing loading state.
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(byoKey ? { 'x-byo-key': byoKey } : {}),
        ...(roomCode ? { 'x-room-code': roomCode } : {}),
      },
      body: JSON.stringify(body),
      signal: guard.signal,
    })
    if (res.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        error: 'The coach is rate-limited right now — try again in a moment.',
      }
    }
    const data = (await res.json().catch(() => ({}))) as {
      text?: string
      model?: string
      error?: string
      review?: ReviewMeta
    }
    if (!res.ok) return { ok: false, error: data.error ?? `Coach error (HTTP ${res.status}).` }
    const text = cleanCoachText(stripFences(data.text ?? ''))
    if (!text) return { ok: false, error: 'Empty response from the coach.' }
    // Callers may render incrementally via onDelta; hand them the full text once
    // so the coach panel updates exactly as before.
    onDelta?.(text)
    return {
      ok: true,
      text,
      ...(data.model ? { model: data.model } : {}),
      ...(data.review ? { review: data.review } : {}),
    }
  } catch {
    if (guard.state.timedOut) {
      return { ok: false, error: 'The coach took too long to answer.', timedOut: true }
    }
    // The caller aborted (turn moved on, panel closed, unmount): not an error
    // anyone needs to see, and callers drop this one silently.
    if (guard.signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: 'Network error reaching the coach.' }
  } finally {
    guard.done()
  }
}
