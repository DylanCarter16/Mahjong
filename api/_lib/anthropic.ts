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
}

export type StreamOutcome =
  | { ok: true; model: string }
  | { ok: false; error: string; status?: number }

interface SseEvent {
  type?: string
  delta?: { type?: string; text?: string; stop_reason?: string }
  error?: { message?: string }
}

async function streamOnce(
  opts: Omit<StreamOptions, 'fallbackModel'>,
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
  if (!emitted) {
    // A completion with no text (refusal, or the token budget consumed before
    // any text) must count as failure so the fallback model gets a turn.
    return { ok: false, error: refusal ? 'refusal' : 'the model returned no text', refusal }
  }
  return { ok: true, model: opts.model }
}

/** Stream a completion, falling back to `fallbackModel` on error or refusal. */
export async function streamCompletion(opts: StreamOptions): Promise<StreamOutcome> {
  let first: StreamOutcome & { refusal?: boolean }
  try {
    first = await streamOnce(opts)
  } catch {
    first = { ok: false, error: 'network error reaching the model API' }
  }
  if (first.ok || !opts.fallbackModel) return first
  try {
    const second = await streamOnce({ ...opts, model: opts.fallbackModel })
    return second.ok ? second : { ok: false, error: second.error, status: second.status }
  } catch {
    return { ok: false, error: 'network error reaching the model API' }
  }
}
