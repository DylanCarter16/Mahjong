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

interface SseChunk {
  text?: string
  error?: string
  done?: boolean
  model?: string
}

async function post(path: string, body: unknown, opts: RequestOptions): Promise<AnalysisResult> {
  const { byoKey, roomCode, signal, onDelta } = opts
  try {
    const stream = Boolean(onDelta)
    const res = await fetch(`${path}${stream ? '?stream=1' : ''}`, {
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
    if (!stream || !res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { text?: string; model?: string; error?: string }
      if (!res.ok) return { ok: false, error: data.error ?? `Coach error (HTTP ${res.status}).` }
      return { ok: true, text: stripFences(data.text ?? ''), ...(data.model ? { model: data.model } : {}) }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    let model: string | undefined
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        let chunk: SseChunk
        try {
          chunk = JSON.parse(raw) as SseChunk
        } catch {
          continue
        }
        if (chunk.text) {
          full += chunk.text
          onDelta?.(full)
        }
        if (chunk.error) return { ok: false, error: chunk.error }
        if (chunk.done) model = chunk.model
      }
    }
    if (!full) return { ok: false, error: 'Empty response from the coach.' }
    return { ok: true, text: stripFences(full), ...(model ? { model } : {}) }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, error: 'cancelled' }
    return { ok: false, error: 'Network error reaching the coach.' }
  }
}
