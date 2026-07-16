/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Serve /api/* through vite dev by loading the Vercel-style handlers with the
// dev server's TS pipeline. Production uses real Vercel functions; this keeps
// `npm run dev` self-contained (spec §2.3 — no key ever reaches the client).
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configResolved(config) {
      // Vite only exposes env files to client code (VITE_*); the API handlers
      // read process.env like real Vercel functions. Mirror the server-side
      // key from .env/.env.local so `npm run dev` matches production. The key
      // never reaches the client bundle — it has no VITE_ prefix.
      const env = loadEnv(config.mode, config.root, '')
      if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
      }
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void handle(server, req, res, next)
      })
    },
  }
}

async function handle(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = req.url ?? ''
  const m = url.match(/^\/api\/(coach|review)(?:\?|$)/)
  if (!m) return next()
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = undefined
    }
    const query = Object.fromEntries(new URL(url, 'http://local').searchParams)
    const vreq = Object.assign(req, { body, query })
    const vres = Object.assign(res, {
      status(code: number) {
        res.statusCode = code
        return vres
      },
      json(obj: unknown) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(obj))
        return vres
      },
      send(data: string) {
        res.end(data)
        return vres
      },
    })
    const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`)
    await (mod.default as (a: unknown, b: unknown) => Promise<void>)(vreq, vres)
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'dev api error' }))
    server.config.logger.error(String(e))
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'api/**/__tests__/**/*.test.ts'],
  },
})
