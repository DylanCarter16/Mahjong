// Anthropic API wrapper. The key arrives as a function argument, lives in the
// caller's component state only, and is never logged, persisted, or included
// in errors. Never throws — every failure comes back as { ok: false }.

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const PRIMARY_MODEL = 'claude-fable-5'
const FALLBACK_MODEL = 'claude-opus-4-8'

export type AnalysisResult = { ok: true; text: string; model: string } | { ok: false; error: string }

/** Strip markdown code fences if the model wrapped its answer in them. */
export function stripFences(text: string): string {
  const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : text.trim()
}

interface MessagesResponse {
  content?: { type: string; text?: string }[]
  stop_reason?: string
  error?: { message?: string }
}

async function callModel(apiKey: string, model: string, prompt: string): Promise<AnalysisResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for browser-side calls with a user-supplied key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = (await res.json().catch(() => ({}))) as MessagesResponse
  if (!res.ok) {
    return { ok: false, error: data.error?.message ?? `API error (HTTP ${res.status})` }
  }
  if (data.stop_reason === 'refusal') {
    return { ok: false, error: 'refusal' }
  }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) return { ok: false, error: 'Empty response from the model.' }
  return { ok: true, text: stripFences(text), model }
}

/** Primary model with one fallback attempt on error or refusal. */
export async function analyse(apiKey: string, prompt: string): Promise<AnalysisResult> {
  try {
    const first = await callModel(apiKey, PRIMARY_MODEL, prompt)
    if (first.ok) return first
    const second = await callModel(apiKey, FALLBACK_MODEL, prompt).catch(
      (): AnalysisResult => ({ ok: false, error: 'Network error reaching the API.' }),
    )
    return second.ok ? second : { ok: false, error: humanise(second.error, first.error) }
  } catch {
    try {
      const second = await callModel(apiKey, FALLBACK_MODEL, prompt)
      return second.ok ? second : { ok: false, error: humanise(second.error) }
    } catch {
      return { ok: false, error: 'Network error reaching the Anthropic API.' }
    }
  }
}

function humanise(...errors: (string | undefined)[]): string {
  const e = errors.filter(Boolean).join('; ')
  if (e.includes('refusal')) return 'The model declined to answer. Try again.'
  if (e.includes('401') || e.toLowerCase().includes('authentication'))
    return 'The API key was rejected — check it and try again.'
  return e || 'Something went wrong talking to the API.'
}
