// Compact text serialisation of game situations for the analysis prompts.
// Uses the repo-wide tile notation (m1..m9, p, s, wE.., dR.., bf/bs).

import type { Action, PlayerView, RoundResult } from '../engine/game'
import { SEATS, type Seat } from '../engine/types'

const SEAT_LABELS: Record<Seat, string> = { 0: 'ME', 1: 'S', 2: 'W', 3: 'N' }

export function serialisePlayerView(view: PlayerView): string {
  const lines: string[] = [
    `notation: m=characters p=circles s=bamboo, wE/S/W/N winds, dR/G/W dragons`,
    `seat wind: ${view.seatWind}  round wind: ${view.roundWind}  faan minimum: ${view.faanMinimum}  wall tiles left: ${view.wallCount}`,
    `my hand: ${view.concealed.join(' ')}`,
    `my bonus tiles: ${view.bonus[view.seat].join(' ') || 'none'}`,
  ]
  for (const seat of SEATS) {
    const melds = view.melds[seat]
      .map((m) => `${m.type}[${m.tiles.join(' ') || 'concealed'}]`)
      .join(' ')
    lines.push(
      `${SEAT_LABELS[seat]}${seat === view.seat ? ' (me)' : ''}: discards: ${
        view.discards[seat].join(' ') || 'none'
      }${melds ? ` | melds: ${melds}` : ''}`,
    )
  }
  if (view.pendingDiscard) {
    lines.push(`pending discard: ${view.pendingDiscard.tile} from ${SEAT_LABELS[view.pendingDiscard.from]}`)
  }
  return lines.join('\n')
}

function serialiseAction(a: Action): string {
  switch (a.type) {
    case 'draw':
      return `${SEAT_LABELS[a.seat]} draws`
    case 'discard':
      return `${SEAT_LABELS[a.seat]} discards ${a.tile}`
    case 'declareWin':
      return `${SEAT_LABELS[a.seat]} declares a self-drawn win`
    case 'pass':
      return `${SEAT_LABELS[a.seat]} passes`
    case 'kong':
      return `${SEAT_LABELS[a.seat]} declares ${a.style} kong of ${a.tile}`
    case 'claim':
      if (a.claim === 'win') return `${SEAT_LABELS[a.seat]} wins off the discard`
      if (a.claim === 'pung') return `${SEAT_LABELS[a.seat]} pungs`
      if (a.claim === 'kong') return `${SEAT_LABELS[a.seat]} kongs the discard`
      return `${SEAT_LABELS[a.seat]} chows with ${a.claim.chow.join(' ')}`
  }
}

export function serialiseLog(log: Action[], result: RoundResult | null): string {
  const lines = log.map((a, i) => `${i + 1}. ${serialiseAction(a)}`)
  if (result) {
    if (result.kind === 'draw') lines.push('RESULT: wall exhausted, nobody won')
    else {
      lines.push(
        `RESULT: ${SEAT_LABELS[result.winner!]} won ${
          result.selfDraw ? 'by self-draw' : `off ${SEAT_LABELS[result.loser!]}'s discard`
        } for ${result.fan?.totalFaan ?? '?'} faan (${
          result.fan?.patterns.map((p) => p.name).join(', ') || 'chicken hand'
        })`,
      )
    }
  }
  return lines.join('\n')
}
