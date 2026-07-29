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
  beginnerAids: true,
  reducedMotion: false,
  byoKey: '',
}

export type { MatchInfo }

/** Round-end disclosure: what the review coach and the win dialog consume. */
export interface FinishedInfo {
  result: RoundResult
  log: Action[]
}

export function useGame(settings: Settings) {
  const roomRef = useRef<SoloRoom | null>(null)
  if (!roomRef.current) {
    roomRef.current = createSoloRoom({
      rules: {
        faanMinimum: settings.faanMinimum,
        flowers: settings.flowers,
        faanCap: settings.faanCap,
      },
      difficulties: settings.difficulties,
    })
  }
  const room = roomRef.current

  const [view, setView] = useState<PlayerView | null>(null)
  const [match, setMatch] = useState<MatchInfo>({
    dealer: 0,
    roundWind: 'E',
    roundNo: 1,
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
  })
  const [finished, setFinished] = useState<FinishedInfo | null>(null)

  useEffect(() => {
    const unsubscribe = room.conn.onMessage((m) => {
      if (m.type === 'view') {
        setView(m.view)
        setMatch(m.match)
        if (m.view.phase !== 'finished') setFinished(null)
      } else if (m.type === 'finished') {
        setFinished({ result: m.result, log: m.log })
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

  return { view, match, finished, dispatch, newRound }
}
