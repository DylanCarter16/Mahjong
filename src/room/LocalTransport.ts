// In-memory transport: single-player. No network, no serialisation,
// synchronous same-tick delivery — solo play works on a bus with no signal
// (spec §0). Messages are still protocol types that would survive JSON, so
// the runner cannot come to depend on in-process object identity.

import type { Seat } from '../engine/types'
import type { ClientMsg, ServerMsg } from './protocol'
import type { ClientConn, Transport } from './transport'

export class LocalTransport implements Transport {
  private handler: ((seat: Seat, msg: ClientMsg) => void) | null = null
  private listeners = new Map<Seat, Set<(msg: ServerMsg) => void>>()

  send(seat: Seat, msg: ServerMsg): void {
    for (const cb of this.listeners.get(seat) ?? []) cb(msg)
  }

  broadcast(msg: ServerMsg): void {
    for (const set of this.listeners.values()) for (const cb of set) cb(msg)
  }

  onMessage(cb: (seat: Seat, msg: ClientMsg) => void): void {
    this.handler = cb
  }

  /** The client end for one seat. */
  client(seat: Seat): ClientConn {
    return {
      send: (msg) => this.handler?.(seat, msg),
      onMessage: (cb) => {
        let set = this.listeners.get(seat)
        if (!set) {
          set = new Set()
          this.listeners.set(seat, set)
        }
        set.add(cb)
        return () => set.delete(cb)
      },
      close: () => this.listeners.delete(seat),
    }
  }
}
