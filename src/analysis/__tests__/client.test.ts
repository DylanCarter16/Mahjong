// The coach client must always settle. `fetch` has no timeout of its own, so
// a proxy that never answers left the panel on "Thinking…" forever — that was
// half of the dead "review that round" button. These tests pin the ceiling and
// the distinction the UI depends on: a TIMEOUT is an error the user sees with
// a retry, a CANCELLATION (turn moved on) is silent.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestReview } from '../client'

const log = [{ type: 'draw' as const, seat: 0 as const }]

afterEach(() => vi.unstubAllGlobals())

describe('requestReview', () => {
  it('gives up with a visible error when nothing comes back', async () => {
    vi.stubGlobal(
      'fetch',
      (_u: unknown, init: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    )
    const r = await requestReview(log, null, { timeoutMs: 30 })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ timedOut: true })
    expect((r as { error: string }).error).toMatch(/too long/i)
  })

  it('reports a caller abort as cancelled, not as an error to show', async () => {
    vi.stubGlobal(
      'fetch',
      (_u: unknown, init: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    )
    const ctl = new AbortController()
    const p = requestReview(log, null, { signal: ctl.signal, timeoutMs: 10_000 })
    ctl.abort()
    const r = await p
    expect(r).toEqual({ ok: false, error: 'cancelled' })
  })

  it('surfaces the proxy error body rather than a bare status', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: false,
        status: 504,
        json: () => Promise.resolve({ error: 'the coach took too long to answer' }),
      }),
    )
    const r = await requestReview(log, null, {})
    expect(r).toEqual({ ok: false, error: 'the coach took too long to answer' })
  })

  it('passes a real answer through', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: '1. Keep your safe tiles.', model: 'test-model' }),
      }),
    )
    const r = await requestReview(log, null, {})
    expect(r).toEqual({ ok: true, text: '1. Keep your safe tiles.', model: 'test-model' })
  })
})
