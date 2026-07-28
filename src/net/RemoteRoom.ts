// The multiplayer client connection: a ClientConn over a WebSocket, so the
// UI cannot tell it apart from solo's LocalTransport end (spec §3).
//
// Mobile reality (spec §6): backgrounding a phone kills the socket, so
// reconnecting is the COMMON path, not an edge case. This wrapper owns the
// whole loop — token storage, exponential backoff, heartbeats — and surfaces
// a status stream the UI renders as a calm overlay, never an error.

import type { ClientMsg, RoomInfo, ServerMsg } from '../room/protocol'
import type { ClientConn } from '../room/transport'
import type { Seat } from '../engine/types'

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'ended'

export interface RemoteRoomHandle extends ClientConn {
  readonly code: string
  onStatus(cb: (status: ConnStatus, detail?: string) => void): () => void
  /** Resolves once the first 'joined' handshake lands. */
  ready: Promise<{ seat: Seat; room: RoomInfo }>
}

/** Close codes the server uses on purpose — do not fight them. */
const CLOSE_ROOM_GONE = 4000
const CLOSE_SEAT_RECLAIMED = 4002

const HEARTBEAT_MS = 20_000
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
const tokenKey = (code: string) => `mahjong.seat-token.${code}`

/**
 * The game server's HTTP base URL. WebSocket URLs are derived from it by
 * swapping the scheme (http→ws, https→wss), so this is the single source of
 * truth for where multiplayer talks to.
 *
 * It comes from the `VITE_GAME_SERVER` build-time env var. In a dev build it
 * defaults to the local `wrangler dev` server. In a PRODUCTION build an unset
 * value is a deploy misconfiguration, so we throw a clear error rather than
 * silently dialing `localhost:8787` — which an https page can't even open
 * (mixed content) and which looks to the user like an unexplained network
 * failure. Set it in the Vercel project and redeploy (see DEPLOY.md).
 */
export function serverBase(): string {
  const configured = (import.meta.env.VITE_GAME_SERVER as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://localhost:8787'
  throw new Error(
    'Multiplayer server not configured: VITE_GAME_SERVER is unset in this build. ' +
      'Set it to your game server URL (e.g. https://mahjong-server.<subdomain>.workers.dev) ' +
      'in the Vercel project settings and redeploy.',
  )
}

export async function createRoom(base = serverBase()): Promise<string> {
  const resp = await fetch(`${base}/api/rooms`, { method: 'POST' })
  if (!resp.ok) throw new Error(`could not create a room (HTTP ${resp.status})`)
  const { code } = (await resp.json()) as { code: string }
  return code
}

export interface RoomPreflight {
  phase: 'lobby' | 'playing'
  joinable: boolean
  seats: { kind: string; name: string | null; connected: boolean }[]
}

export async function roomInfo(code: string, base = serverBase()): Promise<RoomPreflight | null> {
  const resp = await fetch(`${base}/api/rooms/${code}/info`)
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`room lookup failed (HTTP ${resp.status})`)
  return (await resp.json()) as RoomPreflight
}

export function joinRoom(code: string, name: string, base = serverBase()): RemoteRoomHandle {
  const wsBase = base.replace(/^http/, 'ws')
  const listeners = new Set<(msg: ServerMsg) => void>()
  const statusListeners = new Set<(s: ConnStatus, detail?: string) => void>()
  const sendQueue: string[] = []

  let ws: WebSocket | null = null
  let status: ConnStatus = 'connecting'
  let attempts = 0
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closedByUser = false
  let readyResolve!: (v: { seat: Seat; room: RoomInfo }) => void
  let readyReject!: (e: Error) => void
  const ready = new Promise<{ seat: Seat; room: RoomInfo }>((res, rej) => {
    readyResolve = res
    readyReject = rej
  })

  const setStatus = (s: ConnStatus, detail?: string) => {
    status = s
    for (const cb of statusListeners) cb(s, detail)
  }

  const url = () => {
    const token = localStorage.getItem(tokenKey(code))
    return token
      ? `${wsBase}/api/rooms/${code}/ws?token=${encodeURIComponent(token)}`
      : `${wsBase}/api/rooms/${code}/ws?name=${encodeURIComponent(name)}`
  }

  const startHeartbeat = () => {
    stopHeartbeat()
    // The server answers 'ping' from the runtime without waking the room.
    heartbeat = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
    }, HEARTBEAT_MS)
  }
  const stopHeartbeat = () => {
    if (heartbeat !== null) clearInterval(heartbeat)
    heartbeat = null
  }

  const connect = () => {
    if (closedByUser) return
    ws = new WebSocket(url())
    ws.onopen = () => {
      attempts = 0
      setStatus('open')
      startHeartbeat()
      for (const data of sendQueue.splice(0)) ws!.send(data)
    }
    ws.onmessage = (e) => {
      if (e.data === 'pong') return // heartbeat echo
      let msg: ServerMsg
      try {
        msg = JSON.parse(e.data as string) as ServerMsg
      } catch {
        return
      }
      if (msg.type === 'joined') {
        localStorage.setItem(tokenKey(code), msg.token)
        readyResolve({ seat: msg.seat, room: msg.room })
      }
      for (const cb of listeners) cb(msg)
    }
    ws.onclose = (e) => {
      stopHeartbeat()
      if (closedByUser) return
      if (e.code === CLOSE_ROOM_GONE) {
        setStatus('ended', 'The room no longer exists.')
        readyReject(new Error('room gone'))
        return
      }
      if (e.code === CLOSE_SEAT_RECLAIMED) {
        setStatus('ended', 'Your seat was reclaimed from another device.')
        return
      }
      // Everything else — backgrounded phone, flaky wifi, deploy — retries.
      setStatus('reconnecting')
      const delay = BACKOFF_MS[Math.min(attempts++, BACKOFF_MS.length - 1)]
      setTimeout(connect, delay)
    }
    ws.onerror = () => {
      // First-ever attempt failing usually means a bad code or a dead room;
      // ws.onclose fires next and drives the retry/ended decision.
      if (status === 'connecting' && attempts === 0 && !localStorage.getItem(tokenKey(code))) {
        setStatus('ended', 'Could not reach that room. Check the code.')
        closedByUser = true
        readyReject(new Error('join failed'))
      }
    }
  }

  connect()

  return {
    code,
    ready,
    send: (msg: ClientMsg) => {
      const data = JSON.stringify(msg)
      if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      else sendQueue.push(data)
    },
    onMessage: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onStatus: (cb) => {
      statusListeners.add(cb)
      cb(status)
      return () => statusListeners.delete(cb)
    },
    close: () => {
      closedByUser = true
      stopHeartbeat()
      ws?.close(1000, 'leaving')
      setStatus('ended')
    },
  }
}

/** Forget a stored seat token (used when a room is over or was reset). */
export function forgetRoomToken(code: string): void {
  localStorage.removeItem(tokenKey(code))
}
