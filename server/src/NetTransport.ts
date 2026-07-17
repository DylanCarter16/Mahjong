// Transport over hibernatable WebSockets. Sockets are tagged `seat:N` at
// accept time, so addressing a seat is a tag lookup — no in-memory socket
// map to lose when the Durable Object is evicted.

import type { Seat } from '../../src/engine/types'
import type { ClientMsg, ServerMsg } from '../../src/room/protocol'
import type { Transport } from '../../src/room/transport'

export const seatTag = (seat: Seat): string => `seat:${seat}`

export class NetTransport implements Transport {
  private handler: ((seat: Seat, msg: ClientMsg) => void) | null = null

  constructor(private readonly ctx: DurableObjectState) {}

  send(seat: Seat, msg: ServerMsg): void {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets(seatTag(seat))) this.trySend(ws, data)
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) this.trySend(ws, data)
  }

  onMessage(cb: (seat: Seat, msg: ClientMsg) => void): void {
    this.handler = cb
  }

  /** Called by the DO's webSocketMessage handler. */
  deliver(seat: Seat, msg: ClientMsg): void {
    this.handler?.(seat, msg)
  }

  private trySend(ws: WebSocket, data: string): void {
    try {
      ws.send(data)
    } catch {
      // Dying socket — its close/error event follows and handles presence.
    }
  }
}
