// The proxy must ALWAYS answer. A stalled upstream used to hang the function
// until the platform killed it, which reaches the browser as a request that
// never returns — the "review that round spins forever" bug. These tests pin
// the two guarantees that replaced it: one upstream attempt is time-boxed, and
// a timeout is reported as a timeout instead of silently retrying into a
// second model with no budget left.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamCompletion, TIMED_OUT } from '../_lib/anthropic'
import { createHandler } from '../_lib/handler'

/** A fetch that never answers until its caller aborts it. */
function hangingFetch(calls: { n: number }) {
  return (_url: unknown, init: { signal?: AbortSignal }) => {
    calls.n++
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      )
    })
  }
}

const opts = {
  apiKey: 'test-key',
  system: 'sys',
  prompt: 'prompt',
  maxTokens: 10,
  onDelta: () => {},
}

afterEach(() => vi.unstubAllGlobals())

describe('upstream timeout', () => {
  it('gives up on a stalled stream and reports a timeout', async () => {
    const calls = { n: 0 }
    vi.stubGlobal('fetch', hangingFetch(calls))
    const out = await streamCompletion({ ...opts, model: 'm', timeoutMs: 40 })
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ error: TIMED_OUT, status: 504 })
    expect(calls.n).toBe(1)
  })

  it('does not burn the fallback model on a timeout (the budget is already spent)', async () => {
    const calls = { n: 0 }
    vi.stubGlobal('fetch', hangingFetch(calls))
    const out = await streamCompletion({ ...opts, model: 'm', fallbackModel: 'm2', timeoutMs: 40 })
    expect(out.ok).toBe(false)
    expect(calls.n, 'timed out, then tried a second model anyway').toBe(1)
  })

  it('still falls back when the first model fails fast', async () => {
    const models: string[] = []
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      models.push(JSON.parse(init.body).model as string)
      return Promise.resolve(
        models.length === 1
          ? { ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'boom' } }) }
          : {
              ok: true,
              body: {
                getReader: () => {
                  let sent = false
                  return {
                    read: () =>
                      Promise.resolve(
                        sent
                          ? { done: true, value: undefined }
                          : ((sent = true),
                            {
                              done: false,
                              value: new TextEncoder().encode(
                                'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n',
                              ),
                            }),
                      ),
                  }
                },
              },
            },
      )
    })
    let text = ''
    const out = await streamCompletion({
      ...opts,
      model: 'first',
      fallbackModel: 'second',
      timeoutMs: 5_000,
      onDelta: (t) => {
        text += t
      },
    })
    expect(out).toEqual({ ok: true, model: 'second' })
    expect(models).toEqual(['first', 'second'])
    expect(text).toBe('hi')
  })
})

describe('handler responses', () => {
  // The handler needs *a* key to get as far as the upstream call; the fetch is
  // stubbed, so nothing leaves the process.
  process.env.ANTHROPIC_API_KEY ??= 'test-key-not-real'

  type Rec = { statusCode: number; body: { error?: string; text?: string } }
  const call = async (handler: ReturnType<typeof createHandler>) => {
    const rec: Rec = { statusCode: 0, body: {} }
    const res = {
      status(c: number) {
        rec.statusCode = c
        return res
      },
      json(o: unknown) {
        rec.body = o as Rec['body']
        return res
      },
      setHeader() {},
      end() {},
      headersSent: false,
    }
    const req = {
      method: 'POST',
      headers: { origin: 'https://x.test', host: 'x.test', 'x-real-ip': `10.9.9.${Math.floor(Math.random() * 250)}` },
      body: {},
      query: {},
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(req as any, res as any)
    return rec
  }

  it('answers 504 with a message instead of hanging when the model stalls', async () => {
    vi.stubGlobal('fetch', hangingFetch({ n: 0 }))
    const rec = await call(
      createHandler({
        buildPrompt: () => ({ system: 's', prompt: 'p' }),
        model: 'm',
        maxTokens: 10,
        timeoutMs: 40,
      }),
    )
    expect(rec.statusCode).toBe(504)
    expect(rec.body.error).toMatch(/too long/i)
  })

  // The stream layer now catches this first and says WHICH block types arrived
  // (see streamParsing.test.ts) — a strictly better error than the handler's
  // own blank-text guard, which stays as defence in depth.
  it('treats a completion with no text as a failure, not a blank success', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        body: { getReader: () => ({ read: () => Promise.resolve({ done: true, value: undefined }) }) },
      }),
    )
    const rec = await call(
      createHandler({
        buildPrompt: () => ({ system: 's', prompt: 'p' }),
        model: 'm',
        maxTokens: 10,
        timeoutMs: 1_000,
      }),
    )
    expect(rec.statusCode).toBe(502)
    expect(rec.body.error).toMatch(/no text|empty/i)
  })
})
