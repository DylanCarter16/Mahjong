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
  | { ok: false; error: string; status?: number }

interface SseEvent {
  type?: string
  delta?: { type?: string; text?: string; stop_reason?: string }
  error?: { message?: string }
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
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        opts.onDelta(ev.delta.text)
        emitted = true
      }
      if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') refusal = true
      if (ev.type === 'error') return { ok: false, error: ev.error?.message ?? 'upstream stream error' }
    }
  }
  if (refusal && !emitted) return { ok: false, error: 'refusal', refusal: true }
  return { ok: true, model: opts.model }
}

/** Stream a completion, falling back to `fallbackModel` on error or refusal. */
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
