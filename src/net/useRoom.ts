// The multiplayer client hook: wraps RemoteRoom (a ClientConn over a socket)
// and surfaces the same shape the solo useGame hook does — view, match,
// finished — plus room/lobby state and a calm connection status. The table
// and lobby render off this and never touch a socket directly.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Action, PlayerView } from '../engine/game'
import type { Seat } from '../engine/types'
import type { Difficulty } from '../engine/bots'
import {
  createRoom,
  forgetRoomToken,
  joinRoom,
  type ConnStatus,
  type RemoteRoomHandle,
} from './RemoteRoom'
import { SnapshotRecorder } from '../analysis/snapshots'
import type { HouseRules, MatchInfo, RoomInfo } from '../room/protocol'
import type { FinishedInfo } from '../ui/useGame'

export interface RoomState {
  status: ConnStatus
  statusDetail?: string
  room: RoomInfo | null
  view: PlayerView | null
  match: MatchInfo | null
  finished: FinishedInfo | null
  you: Seat | null
  /** A fatal join error (bad code, room full) — distinct from a transient drop. */
  error: string | null
}

export interface RoomControls {
  state: RoomState
  dispatch: (a: Action) => void
  setSeatKind: (seat: Seat, kind: 'open' | 'bot', difficulty?: Difficulty) => void
  setRules: (rules: HouseRules) => void
  start: () => void
  newRound: () => void
  leave: () => void
}

export interface JoinOptions {
  mode: 'create' | 'join'
  /** Required for join; ignored for create. */
  code?: string
  name: string
}

export function useRoom(opts: JoinOptions | null): RoomControls {
  const handleRef = useRef<RemoteRoomHandle | null>(null)
  // See useGame: this seat's own hands, kept for the post-round review.
  const recorder = useRef(new SnapshotRecorder())
  const [state, setState] = useState<RoomState>({
    status: 'connecting',
    room: null,
    view: null,
    match: null,
    finished: null,
    you: null,
    error: null,
  })

  // Identity of the join request; changing it (or unmount) tears down the old
  // socket. opts is passed by value each render, so key on its fields.
  const key = opts ? `${opts.mode}:${opts.code ?? ''}:${opts.name}` : null

  useEffect(() => {
    if (!opts) return
    let cancelled = false
    let handle: RemoteRoomHandle | null = null

    const attach = (h: RemoteRoomHandle) => {
      handle = h
      handleRef.current = h
      h.onStatus((status, detail) =>
        setState((s) => ({ ...s, status, statusDetail: detail })),
      )
      h.onMessage((msg) => {
        // Record BEFORE setState: a state updater must stay pure, and React
        // may call it more than once. The recorder dedupes on seq anyway, but
        // the right place for a side effect is out here.
        if (msg.type === 'view') recorder.current.observe(msg.seq, msg.view, msg.match.roundNo)
        setState((s) => {
          switch (msg.type) {
            case 'joined':
              return { ...s, you: msg.seat, room: msg.room }
            case 'room':
              return { ...s, room: msg.room, you: msg.room.you }
            case 'view':
              return {
                ...s,
                view: msg.view,
                match: msg.match,
                finished: msg.view.phase === 'finished' ? s.finished : null,
              }
            case 'finished':
              return {
                ...s,
                finished: { result: msg.result, log: msg.log, snapshots: recorder.current.take() },
                match: msg.match,
              }
            case 'rejected':
              // A lobby/intent rejection is informational; keep it out of the
              // fatal-error channel (that's for failed joins).
              return s
          }
        })
      })
    }

    const fail = (e: unknown) =>
      setState((s) => ({ ...s, status: 'ended', error: String(e instanceof Error ? e.message : e) }))

    // createRoom()/joinRoom() can throw synchronously if the server URL is
    // misconfigured (serverBase() throws in a prod build with no
    // VITE_GAME_SERVER) — catch that here so it surfaces as a clean error
    // instead of an uncaught exception in the effect.
    try {
      if (opts.mode === 'create') {
        createRoom()
          .then((code) => {
            if (cancelled) return
            attach(joinRoom(code, opts.name))
          })
          .catch(fail)
      } else {
        const code = (opts.code ?? '').trim()
        attach(joinRoom(code, opts.name))
        handle!.ready.catch(fail)
      }
    } catch (e) {
      fail(e)
    }

    return () => {
      cancelled = true
      handle?.close()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const controls = useMemo<Omit<RoomControls, 'state'>>(
    () => ({
      dispatch: (action: Action) => handleRef.current?.send({ type: 'intent', action }),
      setSeatKind: (seat, kind, difficulty) =>
        handleRef.current?.send({
          type: 'lobby',
          op: 'seatKind',
          seat,
          kind,
          ...(difficulty ? { difficulty } : {}),
        }),
      setRules: (rules) => handleRef.current?.send({ type: 'lobby', op: 'rules', rules }),
      start: () => handleRef.current?.send({ type: 'start' }),
      newRound: () => handleRef.current?.send({ type: 'newRound' }),
      leave: () => {
        const h = handleRef.current
        if (h) forgetRoomToken(h.code)
        h?.close()
      },
    }),
    [],
  )

  return { state, ...controls }
}
