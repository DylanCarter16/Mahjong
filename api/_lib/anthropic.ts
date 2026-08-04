// Server-side Anthropic caller with SSE streaming and model fallback.
// The API key is a function argument sourced from process.env (or the
// caller's BYO header) — it is never logged and never appears in responses.

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

export interface StreamOptions {
  apiKey: string
  model: string
  fallbackModel?: string
  system: string
  prompt: string
  maxTokens: number
  onDelta: (text: string) => void
  /**
   * Thinking mode, sent verbatim as the request's `thinking` field.
   *
   * MUST be set explicitly per endpoint. Newer models (Sonnet 5, Opus 5) run
   * ADAPTIVE THINKING when this is omitted, and `max_tokens` caps thinking and
   * response text TOGETHER — so a small budget on a long prompt is spent
   * entirely on reasoning and the response carries no text at all. Both of our
   * endpoints narrate engine-computed facts in a fixed short format, so they
   * disable it: the reasoning adds latency and tokens without improving a
   * 60-to-180-word answer whose numbers are already given to the model.
   */
  thinking?: { type: 'disabled' } | { type: 'adaptive' }
  /**
   * Ceiling on one upstream attempt. Without it a stalled stream hangs until
   * the PLATFORM kills the function, which answers the browser with an opaque
   * gateway error (or nothing at all) — the "review never returns" bug. With
   * it we always get to send our own clean JSON error. Keep the sum of the
   * attempts comfortably under the function's maxDuration.
   */
  timeoutMs?: number
}

export type StreamOutcome =
  | { ok: true; model: string }
  | { ok: false; error: string; status?: number; noText?: NoTextDetail }

/**
 * The SSE shapes we actually read. Note `delta` is a UNION discriminated by its
 * own `type`: `text_delta` carries `.text`, `thinking_delta` carries
 * `.thinking`, `input_json_delta` carries JSON. Reading only `text_delta` is
 * correct for display — but treating "no text_delta arrived" as a SUCCESS with
 * an empty answer is what produced the deterministic empty review.
 */
interface SseEvent {
  type?: string
  index?: number
  content_block?: { type?: string }
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
  error?: { message?: string }
}

/** Why a stream produced no displayable text — reported, never swallowed. */
export interface NoTextDetail {
  /** Content block types the response actually contained. */
  blockTypes: string[]
  /** The message's stop_reason, when the stream reported one. */
  stopReason: string | null
}

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 25_000

/** Marker so the caller can report a timeout as a timeout, not a network blip. */
export const TIMED_OUT = 'the coach took too long to answer'

async function streamOnce(
  opts: Omit<StreamOptions, 'fallbackModel'>,
): Promise<StreamOutcome & { refusal?: boolean }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS)
  try {
    return await streamRequest(opts, ctl.signal)
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, error: TIMED_OUT, status: 504 }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function streamRequest(
  opts: Omit<StreamOptions, 'fallbackModel'>,
  signal: AbortSignal,
): Promise<StreamOutcome & { refusal?: boolean }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      stream: true,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    let message = `upstream error (HTTP ${res.status})`
    try {
      const data = (await res.json()) as { error?: { message?: string } }
      if (data.error?.message) message = data.error.message
    } catch {
      /* keep the generic message */
    }
    return { ok: false, error: message, status: res.status }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let refusal = false
  let emitted = false
  // What the response actually contained, so "no text" can be diagnosed
  // instead of silently becoming an empty string.
  const blockTypes = new Set<string>()
  let stopReason: string | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let ev: SseEvent
      try {
        ev = JSON.parse(raw) as SseEvent
      } catch {
        continue
      }
      if (ev.type === 'content_block_start' && ev.content_block?.type) {
        blockTypes.add(ev.content_block.type)
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        opts.onDelta(ev.delta.text)
        emitted = true
      }
      if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason
        if (ev.delta.stop_reason === 'refusal') refusal = true
      }
      if (ev.type === 'error') return { ok: false, error: ev.error?.message ?? 'upstream stream error' }
    }
  }
  if (refusal && !emitted) return { ok: false, error: 'refusal', refusal: true, noText: { blockTypes: [...blockTypes], stopReason } }

  // A stream that completed cleanly but produced no TEXT is a failure, not an
  // empty success. This is the bug that made "review that round" fail 100% of
  // the time: the model spent its whole max_tokens budget on thinking blocks
  // (adaptive thinking is ON BY DEFAULT on newer models), so not one
  // `text_delta` ever arrived — and returning ok:true with "" both showed the
  // user an empty answer AND skipped the fallback model that would have saved
  // it. Reporting it as a failure makes the fallback fire and gives the log
  // enough to diagnose the next variant of this.
  if (!emitted) {
    return {
      ok: false,
      error: `the model returned no text (blocks: ${[...blockTypes].join(', ') || 'none'}; stop_reason: ${stopReason ?? 'none'})`,
      noText: { blockTypes: [...blockTypes], stopReason },
    }
  }
  return { ok: true, model: opts.model }
}

/**
 * Stream a completion, falling back to `fallbackModel` on error, refusal, or a
 * response that carried no text at all (see streamRequest — that last case is
 * the one that used to surface as a permanently empty answer).
 */
export async function streamCompletion(opts: StreamOptions): Promise<StreamOutcome> {
  const budget = opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const startedAt = Date.now()
  let first: StreamOutcome & { refusal?: boolean }
  try {
    first = await streamOnce(opts)
  } catch {
    first = { ok: false, error: 'network error reaching the model API' }
  }
  if (first.ok || !opts.fallbackModel) return first
  // A timeout means the budget is spent — a second model would only stall the
  // browser further, so report the timeout instead of retrying into it.
  const left = budget - (Date.now() - startedAt)
  if (first.status === 504 || left < 3_000) return first
  try {
    const second = await streamOnce({ ...opts, model: opts.fallbackModel, timeoutMs: left })
    return second.ok ? second : { ok: false, error: second.error, status: second.status }
  } catch {
    return { ok: false, error: 'network error reaching the model API' }
  }
}
