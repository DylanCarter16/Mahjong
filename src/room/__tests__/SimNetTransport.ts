// An in-process stand-in for the real server NetTransport, for the local-vs-
// network PARITY test (§8). It mirrors what the Durable Object path actually
// does that LocalTransport does not: every message crosses a JSON boundary in
// BOTH directions (server→seat and seat→server), and delivery is by seat tag.
//
// It deliberately does NOT touch a real socket or Durable Object — those can't
// run under vitest — but it reproduces the one thing that can silently make
// the network path diverge from the local one: serialization. If a message
// carries something JSON can't round-trip (a Map, a Date, undefined, a class
// instance), this transport will drop or mangle it and the parity assertion
// goes red. That is exactly the drift the spec wants caught.

import type { Seat } from '../../engine/types'
import type { ClientMsg, ServerMsg } from '../protocol'
import type { ClientConn, Transport } from '../transport'

const wire = <T>(msg: T): T => JSON.parse(JSON.stringify(msg)) as T

export class SimNetTransport implements Transport {
  private handler: ((seat: Seat, msg: ClientMsg) => void) | null = null
  private sockets = new Map<Seat, Set<(msg: ServerMsg) => void>>()

  send(seat: Seat, msg: ServerMsg): void {
    const data = JSON.stringify(msg)
    for (const cb of this.sockets.get(seat) ?? []) cb(JSON.parse(data) as ServerMsg)
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg)
    for (const set of this.sockets.values()) for (const cb of set) cb(JSON.parse(data) as ServerMsg)
  }

  onMessage(cb: (seat: Seat, msg: ClientMsg) => void): void {
    this.handler = cb
  }

  client(seat: Seat): ClientConn {
    return {
      // Inbound also crosses the wire, matching webSocketMessage(JSON.parse).
      send: (msg) => this.handler?.(seat, wire(msg)),
      onMessage: (cb) => {
        let set = this.sockets.get(seat)
        if (!set) {
          set = new Set()
          this.sockets.set(seat, set)
        }
        set.add(cb)
        return () => set.delete(cb)
      },
      close: () => this.sockets.delete(seat),
    }
  }
}
