// Response-parsing tests for the coach/review proxy, written against the real
// Anthropic SSE wire shapes.
//
// THE BUG THESE PIN: "review that round" failed 100% of the time with an empty
// answer at normal latency. Not a timeout, not payload size — the response
// simply contained no `text_delta` events. `claude-sonnet-5` runs ADAPTIVE
// THINKING when the request omits `thinking`, and `max_tokens` caps thinking
// and visible text together, so a 700-token budget spent on reasoning over a
// whole action log leaves a response with a `thinking` block and no text block.
// The old parser read only `text_delta`, found nothing, and reported SUCCESS
// with an empty string — which both showed "empty answer" and skipped the
// fallback model that would have rescued it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamCompletion } from '../_lib/anthropic'

/** Build an SSE body from event objects, exactly as the API frames them. */
function sse(...events: unknown[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function streamResponse(body: string) {
  const bytes = new TextEncoder().encode(body)
  let sent = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      }),
    },
  }
}

/** A thinking-only response: the exact shape that produced the empty review. */
const THINKING_ONLY = sse(
  { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: {} } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reviewing turn 14…' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' and turn 19…' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 700 } },
  { type: 'message_stop' },
)

const TEXT_OK = sse(
  { type: 'message_start', message: { id: 'msg_2', model: 'claude-haiku-4-5-20251001', usage: {} } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1. Hold your safe tiles.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
)

const REFUSAL = sse(
  { type: 'message_start', message: { id: 'msg_3', model: 'claude-sonnet-5', usage: {} } },
  { type: 'message_delta', delta: { stop_reason: 'refusal' } },
  { type: 'message_stop' },
)

const base = {
  apiKey: 'test-key',
  system: 'sys',
  prompt: 'prompt',
  maxTokens: 700,
  timeoutMs: 5_000,
}

afterEach(() => vi.unstubAllGlobals())

/** Stub fetch to serve a scripted body per model, recording each request. */
function stubModels(bodies: Record<string, string>) {
  const seen: { model: string; thinking: unknown }[] = []
  vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
    const req = JSON.parse(init.body) as { model: string; thinking?: unknown }
    seen.push({ model: req.model, thinking: req.thinking })
    const body = bodies[req.model]
    if (body === undefined) throw new Error(`no scripted body for ${req.model}`)
    return Promise.resolve(streamResponse(body))
  })
  return seen
}

describe('a response with no text block', () => {
  it('is a failure, not an empty success', async () => {
    stubModels({ 'claude-sonnet-5': THINKING_ONLY })
    let text = ''
    const out = await streamCompletion({
      ...base,
      model: 'claude-sonnet-5',
      onDelta: (t) => {
        text += t
      },
    })
    expect(text).toBe('')
    expect(out.ok, 'a thinking-only response was reported as a successful empty answer').toBe(false)
  })

  it('reports what the response actually contained, so it can be diagnosed', async () => {
    stubModels({ 'claude-sonnet-5': THINKING_ONLY })
    const out = await streamCompletion({ ...base, model: 'claude-sonnet-5', onDelta: () => {} })
    expect(out).toMatchObject({ noText: { blockTypes: ['thinking'], stopReason: 'max_tokens' } })
    expect((out as { error: string }).error).toMatch(/no text/i)
    // The message names the two facts that identify this failure mode.
    expect((out as { error: string }).error).toMatch(/thinking/)
    expect((out as { error: string }).error).toMatch(/max_tokens/)
  })

  it('falls back to the other model instead of surfacing the empty answer', async () => {
    const seen = stubModels({ 'claude-sonnet-5': THINKING_ONLY, 'claude-haiku-4-5-20251001': TEXT_OK })
    let text = ''
    const out = await streamCompletion({
      ...base,
      model: 'claude-sonnet-5',
      fallbackModel: 'claude-haiku-4-5-20251001',
      onDelta: (t) => {
        text += t
      },
    })
    expect(seen.map((s) => s.model)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5-20251001'])
    expect(out).toEqual({ ok: true, model: 'claude-haiku-4-5-20251001' })
    expect(text).toBe('1. Hold your safe tiles.')
  })
})

describe('a refusal', () => {
  it('is reported as a refusal and triggers the fallback', async () => {
    const seen = stubModels({ 'claude-sonnet-5': REFUSAL, 'claude-haiku-4-5-20251001': TEXT_OK })
    const out = await streamCompletion({
      ...base,
      model: 'claude-sonnet-5',
      fallbackModel: 'claude-haiku-4-5-20251001',
      onDelta: () => {},
    })
    expect(seen).toHaveLength(2)
    expect(out.ok).toBe(true)
  })
})

describe('the thinking parameter', () => {
  it('is sent verbatim when set, and omitted when not', async () => {
    const seen = stubModels({ 'claude-sonnet-5': TEXT_OK })
    await streamCompletion({
      ...base,
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
      onDelta: () => {},
    })
    expect(seen[0].thinking).toEqual({ type: 'disabled' })

    const seen2 = stubModels({ 'claude-sonnet-5': TEXT_OK })
    await streamCompletion({ ...base, model: 'claude-sonnet-5', onDelta: () => {} })
    expect(seen2[0].thinking).toBeUndefined()
  })

  it('is pinned off at both endpoints — an omitted value means adaptive', async () => {
    // Guards the actual deployed config, not just the plumbing: if either
    // endpoint stops pinning this, a model whose default is adaptive thinking
    // silently reintroduces the empty-answer bug.
    const review = await import('../_src/review')
    const coach = await import('../_src/coach')
    // The handler closes over its config, so assert via the module's export
    // shape: both files must name the parameter.
    const reviewSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../_src/review.ts', import.meta.url), 'utf8'),
    )
    const coachSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../_src/coach.ts', import.meta.url), 'utf8'),
    )
    expect(reviewSrc).toMatch(/thinking:\s*\{\s*type:\s*'disabled'\s*\}/)
    expect(coachSrc).toMatch(/thinking:\s*\{\s*type:\s*'disabled'\s*\}/)
    expect(typeof review.default).toBe('function')
    expect(typeof coach.default).toBe('function')
  })
})
