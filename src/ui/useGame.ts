import { useEffect, useMemo, useRef, useState } from 'react'
import { botAction, type Difficulty } from '../engine/bots'
import {
  applyAction,
  createGame,
  playerView,
  type Action,
  type GameState,
  type RuleConfig,
} from '../engine/game'
import { makeRng, type Rng } from '../engine/rng'
import { nextSeat, SEATS, type Seat, type Wind } from '../engine/types'

export const HUMAN: Seat = 0

export interface Settings extends RuleConfig {
  difficulties: Record<Seat, Difficulty>
  numberedTiles: boolean
  beginnerAids: boolean
}

export const defaultSettings: Settings = {
  faanMinimum: 3,
  flowers: true,
  faanCap: null,
  difficulties: { 0: 'intermediate', 1: 'easy', 2: 'intermediate', 3: 'advanced' },
  numberedTiles: true,
  beginnerAids: true,
}

export interface MatchInfo {
  dealer: Seat
  roundWind: Wind
  roundNo: number
  /** Cumulative faan won per seat (teaching scoreboard, not point settlement). */
  scores: Record<Seat, number>
}

const WIND_ORDER: Wind[] = ['E', 'S', 'W', 'N']

/** The next automatic action: bot moves and everyone's forced draws. */
function autoAction(s: GameState, difficulties: Record<Seat, Difficulty>, rng: Rng): Action | null {
  if (s.phase === 'finished') return null
  if (s.phase === 'draw') return { type: 'draw', seat: s.turn }
  if (s.phase === 'claims') {
    for (const seat of SEATS) {
      if (seat === HUMAN) continue
      const v = playerView(s, seat)
      if (v.legal.length > 0) return botAction(v, difficulties[seat], rng)
    }
    return null
  }
  if (s.turn !== HUMAN) return botAction(playerView(s, s.turn), difficulties[s.turn], rng)
  return null
}

export function useGame(settings: Settings) {
  const baseSeed = useRef(`match-${Math.random().toString(36).slice(2)}`)
  const rng = useRef(makeRng(baseSeed.current))
  const [match, setMatch] = useState<MatchInfo>({
    dealer: 0,
    roundWind: 'E',
    roundNo: 1,
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
  })
  // Rules are locked in when the round starts; settings changes apply on "next round".
  const [rules, setRules] = useState<RuleConfig>(settings)
  const [state, setState] = useState<GameState>(() =>
    createGame(settings, `${baseSeed.current}-1`, 0, 'E'),
  )
  const scoredRef = useRef(false)

  // Drive bots and forced draws with a small think delay.
  useEffect(() => {
    const a = autoAction(state, settings.difficulties, rng.current)
    if (!a) return
    const delay = a.type === 'draw' ? 300 : 650
    const timer = setTimeout(() => {
      setState((s) => {
        const next = autoAction(s, settings.difficulties, rng.current)
        return next ? applyAction(s, next) : s
      })
    }, delay)
    return () => clearTimeout(timer)
  }, [state, settings.difficulties])

  // Bank the winner's faan onto the scoreboard once per round.
  useEffect(() => {
    if (state.phase !== 'finished') {
      scoredRef.current = false
      return
    }
    if (scoredRef.current) return
    scoredRef.current = true
    const r = state.result
    if (r?.kind === 'win' && r.winner !== undefined && r.fan) {
      setMatch((m) => ({
        ...m,
        scores: { ...m.scores, [r.winner!]: m.scores[r.winner!] + r.fan!.totalFaan },
      }))
    }
  }, [state])

  const view = useMemo(() => playerView(state, HUMAN), [state])

  const dispatch = (a: Action) => setState((s) => applyAction(s, a))

  /** Dealer repeats on a dealer win or a drawn round, otherwise the deal rotates. */
  const newRound = () => {
    const r = state.result
    const dealerRepeats = r?.kind === 'draw' || (r?.kind === 'win' && r.winner === match.dealer)
    const dealer = dealerRepeats ? match.dealer : nextSeat(match.dealer)
    // After the deal passes back to seat 0, the round wind advances.
    const roundWind =
      !dealerRepeats && dealer === 0
        ? WIND_ORDER[(WIND_ORDER.indexOf(match.roundWind) + 1) % 4]
        : match.roundWind
    const roundNo = match.roundNo + 1
    const nextRules: RuleConfig = {
      faanMinimum: settings.faanMinimum,
      flowers: settings.flowers,
      faanCap: settings.faanCap,
    }
    setMatch((m) => ({ ...m, dealer, roundWind, roundNo }))
    setRules(nextRules)
    setState(createGame(nextRules, `${baseSeed.current}-${roundNo}`, dealer, roundWind))
  }

  return { state, view, match, rules, dispatch, newRound }
}
