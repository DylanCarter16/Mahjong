// The Room Durable Object: a dumb shell around RoomHost. It owns exactly
// three things the pure code cannot — sockets, storage, and alarms:
//
//   - WebSockets: hibernation API, tagged by seat, attachment carries the
//     seat index (well under the 2KB serializeAttachment limit).
//   - Storage: a write-through RoomHost snapshot after every change, so a
//     deploy or eviction mid-game recovers through the same reconnect path
//     phones exercise constantly. Snapshots contain the wall — they are
//     server-side only and never leave this object.
//   - Alarms: one real alarm multiplexed over a persisted deadline table.
//
// Timer model (§6). Gameplay timers — bot pacing, claim windows, turn
// timers, disconnect grace — run on the in-memory clock inside RoomHost/
// RoomRunner. They are re-armed from persisted state on every restore()
// (resume() re-arms grace for still-absent humans), so an eviction mid-game
// recovers on the next socket event. Deadlines that must fire with NO
// incoming traffic — room GC — use the durable DO alarm instead, because
// nothing would otherwise wake the object. Promoting the grace/turn
// deadlines to durable alarms (exact firing across a hibernation gap with
// zero traffic) is a known hardening step, not required for the reconnect
// path, which write-through + restore + resend already cover.
//
// Everything that decides anything lives in src/room/ and is tested under
// vitest with a fake clock. If logic is accumulating in this file, stop.

import { DurableObject } from 'cloudflare:workers'
import type { Seat } from '../../src/engine/types'
import { SEATS } from '../../src/engine/types'
import { systemClock } from '../../src/room/clock'
import { makeSeatToken, makeSecretSeed } from '../../src/room/codes'
import type { ClientMsg } from '../../src/room/protocol'
import { RoomHost, type RoomHostSnapshot } from '../../src/room/RoomHost'
import { NetTransport, seatTag } from './NetTransport'
import type { Env } from './env'
import { MAX_WS_MESSAGE_BYTES, timingSafeEqual } from './util'

const SNAPSHOT_KEY = 'snapshot'
const TOKENS_KEY = 'tokens'
const ALARMS_KEY = 'alarms'

/** Room dies this long after the last human socket drops (spec §4). */
const GC_GRACE_MS = 30 * 60 * 1000

/** WebSocket close codes the client understands. */
export const CLOSE_ROOM_GONE = 4000
export const CLOSE_SEAT_RECLAIMED = 4002

type Tokens = Partial<Record<Seat, string>>
type Alarms = Record<string, number>

export class RoomDO extends DurableObject<Env> {
  private host: RoomHost | null = null
  private readonly transport: NetTransport

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.transport = new NetTransport(ctx)
    // Heartbeats answered from the runtime without waking a hibernated DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  // ------------------------------------------------------------ lifecycle --

  private wire(host: RoomHost): void {
    this.transport.onMessage((seat, msg) => {
      host.receive(seat, msg)
    })
  }

  private hostOptions(code: string) {
    return {
      code,
      clock: systemClock,
      transport: this.transport,
      // §2.3: the wall seed is crypto-random, consumed by createGame, and
      // never stored, logged, or transmitted anywhere.
      makeRoundSeed: () => makeSecretSeed(),
      botSeed: makeSecretSeed(),
      logIssue: (m: string) => console.warn(`[room ${code}] ${m}`),
      onDirty: () => this.save(),
    }
  }

  private save(): void {
    if (!this.host) return
    // Fire-and-forget is safe: Durable Object output gates hold outbound
    // messages until pending storage writes commit.
    void this.ctx.storage.put(SNAPSHOT_KEY, this.host.serialize())
  }

  private async load(): Promise<RoomHost | null> {
    if (this.host) return this.host
    const snap = await this.ctx.storage.get<RoomHostSnapshot>(SNAPSHOT_KEY)
    if (!snap) return null
    const host = RoomHost.restore(snap, this.hostOptions(snap.code))
    this.wire(host)
    this.host = host
    // Hibernated sockets survived the eviction; reflect their presence.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { seat: Seat } | null
      if (att) host.setConnected(att.seat, true)
    }
    host.resume()
    return host
  }

  // ---------------------------------------------------------------- fetch --

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    switch (url.pathname) {
      case '/create':
        return this.handleCreate(url)
      case '/info':
        return this.handleInfo()
      case '/ws':
        return this.handleWs(request, url)
      case '/debug':
        return this.handleDebug()
      case '/reset':
        return this.handleReset()
      default:
        return json({ error: 'not found' }, 404)
    }
  }

  private async handleCreate(url: URL): Promise<Response> {
    const code = url.searchParams.get('code') ?? ''
    if (await this.ctx.storage.get(SNAPSHOT_KEY)) {
      return json({ error: 'code collision' }, 409)
    }
    const host = new RoomHost(this.hostOptions(code))
    this.wire(host)
    this.host = host
    this.save()
    // A room nobody ever joins still dies.
    await this.setAlarmFor('gc', Date.now() + GC_GRACE_MS)
    return json({ ok: true })
  }

  private async handleInfo(): Promise<Response> {
    const host = await this.load()
    if (!host) return json({ error: 'no such room' }, 404)
    const info = host.roomInfo(0)
    return json({
      phase: info.phase,
      seats: SEATS.map((s) => ({
        kind: info.seats[s].kind,
        name: info.seats[s].name,
        connected: info.seats[s].connected,
      })),
      joinable: info.phase === 'lobby' && SEATS.some((s) => info.seats[s].kind === 'open'),
    })
  }

  private async handleWs(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected websocket' }, 426)
    }
    const host = await this.load()
    if (!host) return json({ error: 'no such room' }, 404)

    const token = url.searchParams.get('token')
    let seat: Seat
    if (token) {
      // Reclaim: the token is the only credential that maps to a seat (§4).
      const tokens = ((await this.ctx.storage.get<Tokens>(TOKENS_KEY)) ?? {}) as Tokens
      const claimed = SEATS.find((s) => tokens[s] !== undefined && timingSafeEqual(tokens[s]!, token))
      if (claimed === undefined) return json({ error: 'bad token' }, 403)
      seat = claimed
      // One socket per seat: any older connection gets bumped.
      for (const ws of this.ctx.getWebSockets(seatTag(seat))) {
        ws.close(CLOSE_SEAT_RECLAIMED, 'seat reclaimed from another connection')
      }
    } else {
      const name = url.searchParams.get('name') ?? ''
      const joined = host.joinHuman(name)
      if (!joined.ok) return json({ error: joined.reason }, 409)
      seat = joined.seat
      const tokens = ((await this.ctx.storage.get<Tokens>(TOKENS_KEY)) ?? {}) as Tokens
      tokens[seat] = makeSeatToken()
      await this.ctx.storage.put(TOKENS_KEY, tokens)
    }

    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], [seatTag(seat)])
    pair[1].serializeAttachment({ seat })

    // Mark present BEFORE snapshotting the room, so the 'joined' handshake
    // reports the seat as connected (not still reconnecting from the drop).
    host.setConnected(seat, true)
    const tokens = ((await this.ctx.storage.get<Tokens>(TOKENS_KEY)) ?? {}) as Tokens
    pair[1].send(
      JSON.stringify({ type: 'joined', seat, token: tokens[seat]!, room: host.roomInfo(seat) }),
    )
    // Replay the current game view to the returning seat (handback if piloted).
    host.onReconnect(seat)
    await this.clearAlarmFor('gc')
    this.save()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async handleDebug(): Promise<Response> {
    // The 2am escape hatch: a full server-side dump. Gated by ADMIN_KEY at
    // the Worker; the wall and hands are exactly what you need at 2am.
    const snap = await this.ctx.storage.get<RoomHostSnapshot>(SNAPSHOT_KEY)
    const alarms = await this.ctx.storage.get<Alarms>(ALARMS_KEY)
    return json({
      snapshot: snap ?? null,
      alarms: alarms ?? {},
      sockets: SEATS.map((s) => ({ seat: s, open: this.ctx.getWebSockets(seatTag(s)).length })),
      now: Date.now(),
    })
  }

  private async handleReset(): Promise<Response> {
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_ROOM_GONE, 'room reset')
    this.host?.stop()
    this.host = null
    await this.ctx.storage.deleteAll()
    return json({ ok: true })
  }

  // ------------------------------------------------------------- sockets --

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const att = ws.deserializeAttachment() as { seat: Seat } | null
    if (att === null) return
    const host = await this.load()
    if (!host) {
      ws.close(CLOSE_ROOM_GONE, 'room no longer exists')
      return
    }
    const raw = typeof message === 'string' ? message : ''
    // Size guard BEFORE parsing (audit L7): no legitimate ClientMsg is large,
    // so cap the parse rather than letting a client force a big JSON.parse.
    if (raw.length === 0 || raw.length > MAX_WS_MESSAGE_BYTES) {
      if (raw.length > MAX_WS_MESSAGE_BYTES) console.warn(`[room] oversized message from seat ${att.seat}`)
      return
    }
    let msg: ClientMsg
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
        throw new Error('bad shape')
      }
      msg = parsed as ClientMsg
    } catch {
      console.warn(`[room] unparseable message from seat ${att.seat}`)
      return
    }
    // Untrusted input: RoomHost gates host powers and phase; the engine's
    // legalActions gates every game action (§2.1).
    this.transport.deliver(att.seat, msg)
    this.save()
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws)
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as { seat: Seat } | null
    if (att === null) return
    const host = await this.load()
    if (!host) return
    // Only mark disconnected if no OTHER socket still serves this seat.
    const remaining = this.ctx
      .getWebSockets(seatTag(att.seat))
      .filter((w) => w !== ws && w.readyState === WebSocket.READY_STATE_OPEN)
    if (remaining.length === 0) {
      host.setConnected(att.seat, false)
    }
    if (host.allHumansDisconnected()) {
      await this.setAlarmFor('gc', Date.now() + GC_GRACE_MS)
    }
    this.save()
  }

  // -------------------------------------------------------------- alarms --

  private async setAlarmFor(kind: string, at: number): Promise<void> {
    const alarms = ((await this.ctx.storage.get<Alarms>(ALARMS_KEY)) ?? {}) as Alarms
    alarms[kind] = at
    await this.ctx.storage.put(ALARMS_KEY, alarms)
    await this.rearm(alarms)
  }

  private async clearAlarmFor(kind: string): Promise<void> {
    const alarms = ((await this.ctx.storage.get<Alarms>(ALARMS_KEY)) ?? {}) as Alarms
    if (!(kind in alarms)) return
    delete alarms[kind]
    await this.ctx.storage.put(ALARMS_KEY, alarms)
    await this.rearm(alarms)
  }

  private async rearm(alarms: Alarms): Promise<void> {
    const times = Object.values(alarms)
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.min(...times))
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    const alarms = ((await this.ctx.storage.get<Alarms>(ALARMS_KEY)) ?? {}) as Alarms
    for (const [kind, at] of Object.entries(alarms)) {
      if (at > now) continue
      delete alarms[kind]
      if (kind === 'gc' && (await this.gcIfAbandoned())) {
        return // room storage is gone; nothing may write after deleteAll
      }
    }
    await this.ctx.storage.put(ALARMS_KEY, alarms)
    await this.rearm(alarms)
  }

  /** Returns true when the room was destroyed. */
  private async gcIfAbandoned(): Promise<boolean> {
    const host = await this.load()
    if (!host) {
      await this.ctx.storage.deleteAll()
      return true
    }
    if (!host.allHumansDisconnected()) return false // someone came back
    console.log(`[room] GC: last human long gone, deleting room`)
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_ROOM_GONE, 'room expired')
    this.host?.stop()
    this.host = null
    await this.ctx.storage.deleteAll()
    return true
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
