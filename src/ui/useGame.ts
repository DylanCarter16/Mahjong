// Solo play, rehosted on RoomRunner + LocalTransport (Phase 2 §3). The hook
// is now a thin client: it sends intents over a ClientConn and renders the
// PlayerViews that come back. It never touches GameState — the same UI
// contract a multiplayer client gets over a socket.

import { useEffect, useRef, useState } from 'react'
import type { Difficulty } from '../engine/bots'
import type { Action, PlayerView, RoundResult, RuleConfig } from '../engine/game'
import type { Seat } from '../engine/types'
import type { MatchInfo } from '../room/protocol'
import { createSoloRoom, type SoloRoom } from '../room/solo'
import { SnapshotRecorder } from '../analysis/snapshots'
import type { HandSnapshot } from '../engine/review'

export const HUMAN: Seat = 0

/**
 * Client-side settings. Two kinds live here, and the difference matters once
 * multiplayer is involved (§B1):
 *
 *   - RULES (faanMinimum, flowers, difficulties) change how the game is
 *     played. Solo owns them; in multiplayer they are the host's house rules
 *     and this object's copies are not used.
 *   - DISPLAY PREFERENCES (numberedTiles, beginnerAids, reducedMotion) and the
 *     BYO key are personal, local, and affect only this device's view. They
 *     are changeable at any time, in either mode, mid-game — they never touch
 *     game state and never cross the wire.
 */
export interface Settings extends RuleConfig {
  difficulties: Record<Seat, Difficulty>
  numberedTiles: boolean
  beginnerAids: boolean
  /**
   * Force reduced motion on top of the OS setting (never the other way round:
   * a user who asked the OS for reduced motion always gets it).
   */
  reducedMotion: boolean
  /** Optional bring-your-own Anthropic key. Memory only — never persisted. */
  byoKey: string
}

export const defaultSettings: Settings = {
  faanMinimum: 3,
  flowers: true,
  faanCap: null,
  difficulties: { 0: 'intermediate', 1: 'easy', 2: 'intermediate', 3: 'advanced' },
  numberedTiles: true,
  // Off by default: the suggested-discard rings tell you the answer before you
  // have thought about it, which is the wrong first impression of the game.
  // Turn them on from Settings when you want the training wheels. (The coach
  // panel's ranked table is opt-in by opening the panel, so it is not gated on
  // this — only the unsolicited overlays on your own tiles are.)
  beginnerAids: false,
  reducedMotion: false,
  byoKey: '',
}

export type { MatchInfo }

/** Round-end disclosure: what the review coach and the win dialog consume. */
export interface FinishedInfo {
  result: RoundResult
  log: Action[]
  /**
   * This player's own hand at each of their decisions, collected from the view
   * stream as the round was played. The log records that a seat drew, never
   * what it drew, so a concealed hand cannot be recovered afterwards — see
   * analysis/snapshots.ts. Empty when the round wasn't observed from the start
   * (a mid-round join, or a reload), which the review degrades around.
   */
  snapshots: HandSnapshot[]
}

const FRESH_MATCH: MatchInfo = {
  dealer: 0,
  roundWind: 'E',
  roundNo: 1,
  scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
}

const soloRoomFor = (s: Settings): SoloRoom =>
  createSoloRoom({
    rules: { faanMinimum: s.faanMinimum, flowers: s.flowers, faanCap: s.faanCap },
    difficulties: s.difficulties,
  })

export function useGame(settings: Settings) {
  // The room is state, not a ref, so `restart` can replace it. A round in
  // progress can't have its rules swapped underneath it — the runner rightly
  // refuses a new round mid-hand, and that rule is multiplayer's authority
  // model, not something to weaken for solo convenience. So solo gets a fresh
  // ROOM instead: same engine, same runner, dealt from scratch with the rules
  // you just chose. Nothing about the protocol changes.
  const initial = useRef<Settings>(settings)
  const [room, setRoom] = useState<SoloRoom>(() => soloRoomFor(initial.current))

  const [view, setView] = useState<PlayerView | null>(null)
  const [match, setMatch] = useState<MatchInfo>(FRESH_MATCH)
  const [finished, setFinished] = useState<FinishedInfo | null>(null)

  // Collects this seat's hands as the round is played, so the post-round review
  // can grade the decisions. Keyed on match.roundNo, so a new round starts a
  // fresh set without any explicit reset call.
  const recorder = useRef(new SnapshotRecorder())

  useEffect(() => {
    const unsubscribe = room.conn.onMessage((m) => {
      if (m.type === 'view') {
        recorder.current.observe(m.seq, m.view, m.match.roundNo)
        setView(m.view)
        setMatch(m.match)
        if (m.view.phase !== 'finished') setFinished(null)
      } else if (m.type === 'finished') {
        setFinished({ result: m.result, log: m.log, snapshots: recorder.current.take() })
        setMatch(m.match)
      }
    })
    room.runner.start()
    return () => {
      unsubscribe()
      room.runner.stop()
    }
  }, [room])

  // Settings changes apply on "next round", same as the rules always have.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const dispatch = (a: Action) => room.conn.send({ type: 'intent', action: a })

  const newRound = () => {
    const s = settingsRef.current
    room.conn.send({
      type: 'newRound',
      rules: { faanMinimum: s.faanMinimum, flowers: s.flowers, faanCap: s.faanCap },
      seats: {
        0: { kind: 'human' },
        1: { kind: 'bot', difficulty: s.difficulties[1] },
        2: { kind: 'bot', difficulty: s.difficulties[2] },
        3: { kind: 'bot', difficulty: s.difficulties[3] },
      },
    })
  }

  /**
   * Abandon this hand and deal a brand-new solo game under the CURRENT
   * settings. The escape hatch for "I changed the rules and nothing happened":
   * mid-hand, rule changes can only ever land on the next round, so when that
   * is not what you meant, this gives you the round now. Scores reset with it —
   * it is a new game, and it says so on the button.
   */
  const restart = () => {
    room.runner.stop()
    setView(null)
    setFinished(null)
    setMatch(FRESH_MATCH)
    setRoom(soloRoomFor(settingsRef.current))
  }

  return { view, match, finished, dispatch, newRound, restart }
}
