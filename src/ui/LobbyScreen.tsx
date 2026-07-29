// The lobby (§7): create/join surface, big readable room code with one-tap
// copy, seat list with per-seat human/bot/open state, host controls, a
// house-rule summary, and start. Calmer register than the felt table — this
// reuses the lessons/settings visual language (emerald panels, amber accent),
// no new visual vocabulary. Mobile-first single column; all controls ≥44px.

import { useState } from 'react'
import type { Difficulty } from '../engine/bots'
import { SEATS, type Seat } from '../engine/types'
import type { HouseRules, RoomInfo } from '../room/protocol'

const DIFFS: Difficulty[] = ['easy', 'intermediate', 'advanced']
const seatWindLabel = ['East', 'South', 'West', 'North']

export function LobbyScreen({
  room,
  you,
  byoKeySlot,
  onSetSeatKind,
  onSetRules,
  onStart,
  onLeave,
}: {
  room: RoomInfo
  you: Seat
  /** BYO-key control, surfaced in the lobby by Phase 8 (§9). */
  byoKeySlot?: React.ReactNode
  onSetSeatKind: (seat: Seat, kind: 'open' | 'bot', difficulty?: Difficulty) => void
  onSetRules: (rules: HouseRules) => void
  onStart: () => void
  onLeave: () => void
}) {
  const isHost = room.hostSeat === you
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context / permissions) — the code is on
      // screen to read aloud regardless.
    }
  }

  const setRule = <K extends keyof HouseRules>(key: K, value: HouseRules[K]) =>
    onSetRules({ ...room.rules, [key]: value })

  const humansReady = SEATS.filter((s) => room.seats[s].kind === 'human').length

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 text-emerald-50">
      <div className="flex items-center justify-between">
        <button
          className="min-h-11 rounded-lg px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-800 cursor-pointer"
          onClick={onLeave}
        >
          ← Leave
        </button>
        <span className="text-sm text-emerald-300/70">
          {isHost ? 'You are the host' : `Host: ${room.seats[room.hostSeat].name ?? 'seat ' + room.hostSeat}`}
        </span>
      </div>

      {/* Room code — big, readable, one-tap copy. */}
      <div className="rounded-2xl border border-emerald-700 bg-emerald-900/60 p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-emerald-300/70">Room code</p>
        <button
          onClick={copyCode}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-1 font-mono text-4xl font-bold tracking-[0.2em] text-amber-300 hover:bg-emerald-800/60 cursor-pointer"
          aria-label={`Room code ${room.code.split('').join(' ')}. Tap to copy.`}
        >
          {room.code}
          <span aria-hidden className="text-base text-emerald-300/70">{copied ? '✓' : '⧉'}</span>
        </button>
        <p className="mt-1 text-xs text-emerald-300/60">
          {copied ? 'Copied!' : 'Read it aloud or tap to copy — others join with this code.'}
        </p>
      </div>

      {/* Seats. */}
      <section aria-label="Seats">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-emerald-300/70">Seats</h2>
        <ul className="flex flex-col gap-2">
          {SEATS.map((seat) => {
            const st = room.seats[seat]
            const mine = seat === you
            return (
              <li
                key={seat}
                className="flex items-center justify-between gap-3 rounded-xl border border-emerald-800 bg-emerald-900/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {st.kind === 'human' ? st.name : st.kind === 'bot' ? 'Bot' : 'Open seat'}
                    </span>
                    {mine && <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[0.6rem] text-amber-200">you</span>}
                    {room.hostSeat === seat && <span className="text-amber-300" title="host">★</span>}
                  </div>
                  <span className="text-xs text-emerald-300/60">{seatWindLabel[seat]}</span>
                </div>

                {/* Host controls for non-host, non-human seats. */}
                {isHost && st.kind !== 'human' ? (
                  <div className="flex items-center gap-1.5">
                    {st.kind === 'bot' && (
                      <select
                        aria-label={`Bot difficulty for the ${seatWindLabel[seat]} seat`}
                        className="min-h-11 rounded bg-emerald-800 px-2 text-sm text-emerald-50 border border-emerald-600"
                        value={st.difficulty}
                        onChange={(e) => onSetSeatKind(seat, 'bot', e.target.value as Difficulty)}
                      >
                        {DIFFS.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                    <button
                      className="min-h-11 min-w-11 rounded-lg border border-emerald-600 px-3 text-sm hover:bg-emerald-800 cursor-pointer"
                      onClick={() => onSetSeatKind(seat, st.kind === 'bot' ? 'open' : 'bot')}
                    >
                      {st.kind === 'bot' ? 'Open' : 'Add bot'}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-emerald-300/50">
                    {st.kind === 'bot' ? st.difficulty : st.kind === 'human' ? 'ready' : 'waiting'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* House rules — editable by host, summary for everyone else. */}
      <section aria-label="House rules">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-emerald-300/70">House rules</h2>
        {isHost ? (
          <div className="flex flex-col gap-2 rounded-xl border border-emerald-800 bg-emerald-900/40 p-3">
            <Row label="Minimum faan" htmlFor="faan">
              <select
                id="faan"
                className="min-h-11 rounded bg-emerald-800 px-2 text-sm border border-emerald-600"
                value={room.rules.faanMinimum}
                onChange={(e) => setRule('faanMinimum', Number(e.target.value) as 0 | 1 | 3)}
              >
                <option value={0}>0 (family rules)</option>
                <option value={1}>1</option>
                <option value={3}>3</option>
              </select>
            </Row>
            <Row label="Flowers & seasons" htmlFor="flowers">
              <input
                id="flowers"
                type="checkbox"
                className="h-6 w-6"
                checked={room.rules.flowers}
                onChange={(e) => setRule('flowers', e.target.checked)}
              />
            </Row>
            <Row label="Claim window" htmlFor="claim">
              <select
                id="claim"
                className="min-h-11 rounded bg-emerald-800 px-2 text-sm border border-emerald-600"
                value={room.rules.claimWindowSec}
                onChange={(e) => setRule('claimWindowSec', Number(e.target.value))}
              >
                {[3, 4, 5, 6, 7, 8].map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            </Row>
            <Row label="Turn timer" htmlFor="turn">
              <select
                id="turn"
                className="min-h-11 rounded bg-emerald-800 px-2 text-sm border border-emerald-600"
                value={room.rules.turnTimerSec}
                onChange={(e) => setRule('turnTimerSec', Number(e.target.value))}
              >
                {[15, 20, 30, 45, 60].map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            </Row>
            <Row label="AI coach allowed" htmlFor="coach">
              <input
                id="coach"
                type="checkbox"
                className="h-6 w-6"
                checked={room.rules.coachAllowed}
                onChange={(e) => setRule('coachAllowed', e.target.checked)}
              />
            </Row>
          </div>
        ) : (
          <p className="rounded-xl border border-emerald-800 bg-emerald-900/40 p-3 text-sm text-emerald-200/80">
            {summariseRules(room.rules)}
          </p>
        )}
      </section>

      {byoKeySlot}

      {isHost ? (
        <button
          className="min-h-11 w-full rounded-xl bg-amber-400 py-3 text-base font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
          onClick={onStart}
        >
          Start game{humansReady < 4 ? ' (empty seats become bots)' : ''}
        </button>
      ) : (
        <p className="text-center text-sm text-emerald-300/70" role="status">
          Waiting for the host to start…
        </p>
      )}
    </div>
  )
}

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm">{label}</label>
      {children}
    </div>
  )
}

function summariseRules(r: HouseRules): string {
  return [
    `${r.faanMinimum} faan min`,
    r.flowers ? 'flowers on' : 'no flowers',
    `${r.claimWindowSec}s claims`,
    `${r.turnTimerSec}s turns`,
    r.coachAllowed ? 'coach on' : 'coach off',
  ].join(' · ')
}
