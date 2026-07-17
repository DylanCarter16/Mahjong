import type { RoomDO } from './RoomDO'

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>
  /** Comma-separated allowed browser origins; empty/unset = allow any. */
  ALLOWED_ORIGINS?: string
  /** Gates /debug and /reset. Unset = admin routes disabled. */
  ADMIN_KEY?: string
}
