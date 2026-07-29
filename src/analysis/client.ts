// Client for the /api proxy. No prompts are built here and no key is
// required — the server holds the key and constructs all prompt text. An
// optional bring-your-own key (Settings) is forwarded as a header, kept in
// memory only, and skips the shared rate limit.

import type { Action, PlayerView, RoundResult } from '../engine/game'

export type AnalysisResult =
  | { ok: true; text: string; model?: string }
  | { ok: false; error: string; rateLimited?: boolean }

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
}

export const requestCoach = (view: PlayerView, opts: RequestOptions = {}) =>
  post('/api/coach', { view }, opts)

export const requestReview = (log: Action[], result: RoundResult | null, opts: RequestOptions = {}) =>
  post('/api/review', { log, result }, opts)

async function post(path: string, body: unknown, opts: RequestOptions): Promise<AnalysisResult> {
  const { byoKey, roomCode, signal, onDelta } = opts
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
      ...(signal ? { signal } : {}),
    })
    if (res.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        error: 'The coach is rate-limited right now — try again in a moment.',
      }
    }
    const data = (await res.json().catch(() => ({}))) as { text?: string; model?: string; error?: string }
    if (!res.ok) return { ok: false, error: data.error ?? `Coach error (HTTP ${res.status}).` }
    const text = stripFences(data.text ?? '')
    if (!text) return { ok: false, error: 'Empty response from the coach.' }
    // Callers may render incrementally via onDelta; hand them the full text once
    // so the coach panel updates exactly as before.
    onDelta?.(text)
    return { ok: true, text, ...(data.model ? { model: data.model } : {}) }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, error: 'cancelled' }
    return { ok: false, error: 'Network error reaching the coach.' }
  }
}
