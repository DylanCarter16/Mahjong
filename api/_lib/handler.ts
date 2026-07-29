// Shared proxy handler. This is NOT an open proxy: the client sends game
// state, the server validates it strictly, builds the prompt itself, pins the
// model and max_tokens, rate-limits anonymous callers, and requires a
// same-origin Origin header. No client-supplied system/model/messages, ever.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { streamCompletion } from './anthropic'
import { makeLimiter, sameOrigin } from './limiter'

export interface EndpointConfig {
  /** Validate the body and build the full prompt server-side, or null to reject. */
  buildPrompt: (body: unknown) => { system: string; prompt: string } | null
  model: string
  fallbackModel?: string
  maxTokens: number
}

// In-memory rate buckets. IMPORTANT (audit H2): these are per warm function
// INSTANCE and reset on cold start, so on their own they are NOT a global cap —
// Vercel fans requests across instances. The `Limiter` interface is the drop-in
// seam for shared storage (Vercel KV / Upstash Redis); wiring that in is the
// only thing that makes the daily numbers a true global ceiling. Until then:
//   - `limiter`       per real client IP (x-real-ip), shared key.
//   - `roomLimiter`   per room (§9) — advisory only (key is client-supplied, M1).
//   - `globalLimiter` an IP-INDEPENDENT ceiling, so rotating IPs can't lift the
//                     cap without bound within an instance.
//   - `byoLimiter`    a looser cap on BYO-key requests (L3) — the model bill is
//                     theirs, but our compute/upstream budget still needs a floor.
const limiter = makeLimiter({ perMinute: 20, perDay: 200 })
const roomLimiter = makeLimiter({ perMinute: 15, perDay: 150 })
const globalLimiter = makeLimiter({ perMinute: 60, perDay: 1000 })
const byoLimiter = makeLimiter({ perMinute: 30, perDay: 500 })

const BYO_KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{8,}$/

function firstHeader(req: VercelRequest, name: string): string | undefined {
  const h = req.headers[name]
  return Array.isArray(h) ? h[0] : h
}

/**
 * The real client IP. On Vercel, `x-real-ip` is set by the platform to the
 * true client and is single-valued — use it. We deliberately do NOT key on
 * `x-forwarded-for`: its LEFT end is the client-controlled end (each hop
 * appends), so trusting it lets an attacker land in a fresh bucket per request
 * (audit H2). Off-platform (local dev), fall back to the socket peer.
 */
function clientIp(req: VercelRequest): string {
  const real = firstHeader(req, 'x-real-ip')?.trim()
  return real && real.length > 0 ? real : req.socket?.remoteAddress || 'unknown'
}

/** Client-supplied room code, used only as a rate-limit bucket key (advisory). */
function roomBucket(req: VercelRequest): string | null {
  const code = firstHeader(req, 'x-room-code')?.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return code && code.length > 0 ? `room:${code}` : null
}

export function createHandler(cfg: EndpointConfig) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' })
        return
      }
      const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
      if (!sameOrigin(origin, req.headers.host)) {
        res.status(403).json({ error: 'same-origin requests only' })
        return
      }

      const byoHeader = firstHeader(req, 'x-byo-key')
      let byoKey: string | null = null
      if (byoHeader !== undefined && byoHeader !== '') {
        // L3: a garbage BYO key used to skip rate limiting yet still run an
        // upstream fetch (free DoS on our compute). Reject junk BEFORE any
        // upstream work; only a well-formed key proceeds, and even then it is
        // rate-limited (looser) so a rotated key can't hammer the function.
        if (byoHeader.length >= 250 || !BYO_KEY_SHAPE.test(byoHeader)) {
          res.status(400).json({ error: 'invalid API key format' })
          return
        }
        byoKey = byoHeader
      }

      if (byoKey) {
        const byoRetry = byoLimiter.check(clientIp(req))
        if (byoRetry !== null) {
          res.setHeader('Retry-After', String(byoRetry))
          res.status(429).json({ error: 'rate limited', retryAfter: byoRetry })
          return
        }
      } else {
        // Room budget first (tighter, shared), then per-IP, then the IP-
        // independent global ceiling — so every path that would spend the
        // shared key is counted against at least one cap that can't be reset
        // by rotating the client-controlled inputs.
        const room = roomBucket(req)
        const roomRetry = room ? roomLimiter.check(room) : null
        const ipRetry = roomRetry ?? limiter.check(clientIp(req))
        const retryAfter = ipRetry ?? globalLimiter.check('shared-key')
        if (retryAfter !== null) {
          res.setHeader('Retry-After', String(retryAfter))
          res.status(429).json({
            error:
              roomRetry !== null
                ? 'this room has hit its shared coach limit'
                : ipRetry === null
                  ? 'the coach is busy right now — try again shortly'
                  : 'rate limited',
            retryAfter,
          })
          return
        }
      }

      const built = cfg.buildPrompt(req.body)
      if (!built) {
        res.status(400).json({ error: 'invalid request body' })
        return
      }

      const apiKey = byoKey ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        res.status(503).json({ error: 'coach not configured on this deployment' })
        return
      }

      const wantStream = req.query?.stream === '1'
      if (wantStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.status(200)
        // A stream write can fail mid-flight — the client navigated away or the
        // socket dropped (the in-game coach aborts on every view change). A raw
        // throw here used to unwind into the catch below, which then tried to
        // set a 500 status AFTER the SSE headers were already committed; that
        // second throw was uncaught and reached the client as an opaque
        // platform HTTP 500. Swallow write failures so the stream just ends.
        const sse = (obj: unknown) => {
          try {
            res.write(`data: ${JSON.stringify(obj)}\n\n`)
          } catch {
            /* client gone — nothing more to send */
          }
        }
        const outcome = await streamCompletion({
          apiKey,
          model: cfg.model,
          ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}),
          system: built.system,
          prompt: built.prompt,
          maxTokens: cfg.maxTokens,
          onDelta: (text) => sse({ text }),
        })
        sse(outcome.ok ? { done: true, model: outcome.model } : { error: outcome.error })
        try {
          res.end()
        } catch {
          /* already closed */
        }
        return
      }

      let full = ''
      const outcome = await streamCompletion({
        apiKey,
        model: cfg.model,
        ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}),
        system: built.system,
        prompt: built.prompt,
        maxTokens: cfg.maxTokens,
        onDelta: (text) => {
          full += text
        },
      })
      if (!outcome.ok) {
        res.status(outcome.status === 401 ? 401 : 502).json({ error: outcome.error })
        return
      }
      res.status(200).json({ text: full, model: outcome.model })
    } catch {
      // Never leak internals (or the key) into an error response. And never try
      // to set a status once the response has started streaming — that throws
      // again and the client sees an opaque platform 500 instead of the real,
      // already-sent SSE error.
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal error' })
      } else {
        try {
          res.end()
        } catch {
          /* already closed */
        }
      }
    }
  }
}
