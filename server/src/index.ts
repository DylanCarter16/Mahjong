// Worker entry: routes requests to the right room's Durable Object.
//
//   POST /api/rooms                → create a room, returns { code }
//   GET  /api/rooms/:code/info     → lobby preflight (exists? joinable?)
//   GET  /api/rooms/:code/ws       → WebSocket upgrade (?name= join, ?token= reclaim)
//   GET  /api/rooms/:code/debug    → admin dump   (x-admin-key)
//   POST /api/rooms/:code/reset    → admin reset  (x-admin-key)
//
// The Worker holds no state and no game knowledge; it validates the code
// shape, enforces origin policy, and forwards.

import { isValidRoomCode, makeRoomCode, normalizeRoomCode } from '../../src/room/codes'
import type { Env } from './env'

export { RoomDO } from './RoomDO'

const CREATE_ATTEMPTS = 5

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    if (!originAllowed(origin, env)) {
      return json({ error: 'origin not allowed' }, 403, corsHeaders(null))
    }
    const cors = corsHeaders(origin)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      return createRoom(env, cors)
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(info|ws|debug|reset)$/)
    if (!m) return json({ error: 'not found' }, 404, cors)
    const code = normalizeRoomCode(m[1])
    const route = m[2]
    if (!isValidRoomCode(code)) return json({ error: 'bad room code' }, 400, cors)

    if (route === 'debug' || route === 'reset') {
      if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
        return json({ error: 'not found' }, 404, cors)
      }
      if (route === 'reset' && request.method !== 'POST') {
        return json({ error: 'POST required' }, 405, cors)
      }
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
    const forward = new URL(request.url)
    forward.pathname = `/${route}`
    const resp = await stub.fetch(new Request(forward, request))

    // WebSocket upgrade responses pass through untouched.
    if (resp.status === 101) return resp
    return withHeaders(resp, cors)
  },
} satisfies ExportedHandler<Env>

async function createRoom(env: Env, cors: Record<string, string>): Promise<Response> {
  for (let i = 0; i < CREATE_ATTEMPTS; i++) {
    const code = makeRoomCode()
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
    const resp = await stub.fetch(`https://do/create?code=${code}`)
    if (resp.ok) return json({ code }, 200, cors)
    // 409 = collision with a live room; try another code.
  }
  return json({ error: 'could not allocate a room code' }, 503, cors)
}

function originAllowed(origin: string | null, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length === 0) return true // dev posture; set ALLOWED_ORIGINS in prod
  if (!origin) return true // same-origin/native requests carry no Origin header
  return allowed.includes(origin)
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function withHeaders(resp: Response, headers: Record<string, string>): Response {
  const out = new Response(resp.body, resp)
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v)
  return out
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
