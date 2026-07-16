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

const limiter = makeLimiter({ perMinute: 20, perDay: 200 })

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd
  return first?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
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

      const byoHeader = req.headers['x-byo-key']
      const byoKey = typeof byoHeader === 'string' && byoHeader.length > 0 && byoHeader.length < 250 ? byoHeader : null

      if (!byoKey) {
        const retryAfter = limiter.check(clientIp(req))
        if (retryAfter !== null) {
          res.setHeader('Retry-After', String(retryAfter))
          res.status(429).json({ error: 'rate limited', retryAfter })
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
        res.status(200)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        const outcome = await streamCompletion({
          apiKey,
          model: cfg.model,
          ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}),
          system: built.system,
          prompt: built.prompt,
          maxTokens: cfg.maxTokens,
          onDelta: (text) => res.write(`data: ${JSON.stringify({ text })}\n\n`),
        })
        res.write(
          `data: ${JSON.stringify(outcome.ok ? { done: true, model: outcome.model } : { error: outcome.error })}\n\n`,
        )
        res.end()
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
      // Never leak internals (or the key) into an error response.
      res.status(500).json({ error: 'internal error' })
    }
  }
}
