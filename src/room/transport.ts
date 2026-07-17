// The transport seam (spec §3). RoomRunner talks to seats only through
// Transport; a client holds only a ClientConn. LocalTransport pairs them
// in-memory for offline solo play; the Phase 2 server implements Transport
// over WebSockets. If anything outside the implementations can tell which
// one it is running on, the seam has leaked and we implemented it wrong.

import type { Seat } from '../engine/types'
import type { ClientMsg, ServerMsg } from './protocol'

export interface Transport {
  send(seat: Seat, msg: ServerMsg): void
  broadcast(msg: ServerMsg): void
  onMessage(cb: (seat: Seat, msg: ClientMsg) => void): void
}

/** The seat-side handle: what the solo UI or the socket wrapper holds. */
export interface ClientConn {
  send(msg: ClientMsg): void
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: ServerMsg) => void): () => void
  close(): void
}
