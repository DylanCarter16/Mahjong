// The Play tab's entry point (§7): choose solo, create a room, or join one.
// Solo stays exactly what it was — a fully offline GameScreen — so grinding on
// the bus with no signal is unaffected. Create/Join collect a display name
// (and, for join, a room code) then hand off to the multiplayer screen.

import { useState } from 'react'
import { isValidRoomCode, normalizeRoomCode } from '../room/codes'
import type { JoinOptions } from '../net/useRoom'
import { GameScreen } from './GameScreen'
import { MultiplayerScreen } from './MultiplayerScreen'
import { SettingsPanel } from './SettingsPanel'
import type { Settings } from './useGame'

type Mode = { kind: 'menu' } | { kind: 'solo' } | { kind: 'mp'; join: JoinOptions }

const LAST_NAME_KEY = 'mahjong.display-name'

export function PlayHub({ settings, onChangeSettings }: {
  settings: Settings
  onChangeSettings: (s: Settings) => void
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' })

  if (mode.kind === 'solo') {
    return (
      <div className="flex flex-col">
        <BackBar onBack={() => setMode({ kind: 'menu' })} />
        <GameScreen settings={settings} onChangeSettings={onChangeSettings} />
      </div>
    )
  }
  if (mode.kind === 'mp') {
    return (
      <MultiplayerScreen
        join={mode.join}
        settings={settings}
        onChangeSettings={onChangeSettings}
        onLeave={() => setMode({ kind: 'menu' })}
      />
    )
  }
  return (
    <Menu
      settings={settings}
      onChangeSettings={onChangeSettings}
      onSolo={() => setMode({ kind: 'solo' })}
      onJoin={(join) => setMode({ kind: 'mp', join })}
    />
  )
}

const DIFF_SHORT: Record<string, string> = { easy: 'easy', intermediate: 'int', advanced: 'adv' }

/** What you are about to be dealt, in one line, before you commit to it. */
function rulesSummary(s: Settings): string {
  return [
    `${s.faanMinimum} faan min`,
    s.flowers ? 'flowers on' : 'no flowers',
    `bots: ${[1, 2, 3].map((seat) => DIFF_SHORT[s.difficulties[seat as 1 | 2 | 3]]).join('/')}`,
    s.beginnerAids ? 'aids on' : 'aids off',
  ].join(' · ')
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-2">
      <button
        className="min-h-11 rounded-lg px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-800 cursor-pointer"
        onClick={onBack}
      >
        ← Menu
      </button>
    </div>
  )
}

function Menu({
  settings,
  onChangeSettings,
  onSolo,
  onJoin,
}: {
  settings: Settings
  onChangeSettings: (s: Settings) => void
  onSolo: () => void
  onJoin: (join: JoinOptions) => void
}) {
  const [panel, setPanel] = useState<'none' | 'create' | 'join'>('none')
  const [name, setName] = useState(() => localStorage.getItem(LAST_NAME_KEY) ?? '')
  const [code, setCode] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const trimmedName = name.trim()
  const validCode = isValidRoomCode(normalizeRoomCode(code))

  const go = (mode: 'create' | 'join') => {
    localStorage.setItem(LAST_NAME_KEY, trimmedName)
    onJoin(
      mode === 'create'
        ? { mode: 'create', name: trimmedName }
        : { mode: 'join', code: normalizeRoomCode(code), name: trimmedName },
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8 text-emerald-50">
      <div className="rounded-2xl border border-emerald-700 bg-emerald-900/50 p-6">
        <h2 className="text-lg font-bold">Play solo</h2>
        <p className="mt-1 text-sm text-emerald-200/70">
          You and three bots. Fully offline — no signal needed.
        </p>
        {/* Set the rules BEFORE the deal. Mid-game they can only land on the
            next round, which is the right behaviour for a hand in progress and
            the wrong first experience — so the choice lives here too. */}
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-800 bg-emerald-900/50 px-3 py-2">
          <span className="min-w-0 text-xs text-emerald-200/80">{rulesSummary(settings)}</span>
          <button
            className="min-h-11 shrink-0 rounded-lg border border-emerald-600 px-3 text-sm text-emerald-100 hover:bg-emerald-800 cursor-pointer"
            onClick={() => setShowSettings(true)}
          >
            ⚙ Change
          </button>
        </div>
        <button
          className="mt-3 min-h-11 w-full rounded-xl bg-amber-400 py-3 font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
          onClick={onSolo}
        >
          Start solo game
        </button>
      </div>

      <div className="rounded-2xl border border-emerald-700 bg-emerald-900/50 p-6">
        <h2 className="text-lg font-bold">Play with people</h2>
        <p className="mt-1 text-sm text-emerald-200/70">
          2–4 humans on different devices, empty seats filled by bots.
        </p>

        <label htmlFor="name" className="mt-3 block text-sm text-emerald-100">Your name</label>
        <input
          id="name"
          className="mt-1 min-h-11 w-full rounded-lg border border-emerald-600 bg-emerald-800 px-3 py-2 text-emerald-50"
          value={name}
          maxLength={24}
          placeholder="e.g. Dylan"
          onChange={(e) => setName(e.target.value)}
        />

        {panel === 'none' && (
          <div className="mt-3 flex gap-2">
            <button
              className="min-h-11 flex-1 rounded-xl bg-emerald-700 py-3 font-semibold hover:bg-emerald-600 disabled:opacity-40 cursor-pointer"
              disabled={trimmedName.length === 0}
              onClick={() => setPanel('create')}
            >
              Create room
            </button>
            <button
              className="min-h-11 flex-1 rounded-xl bg-emerald-700 py-3 font-semibold hover:bg-emerald-600 disabled:opacity-40 cursor-pointer"
              disabled={trimmedName.length === 0}
              onClick={() => setPanel('join')}
            >
              Join room
            </button>
          </div>
        )}

        {panel === 'create' && (
          <div className="mt-3">
            <p className="text-sm text-emerald-200/70">You'll get a code to share with your table.</p>
            <button
              className="mt-2 min-h-11 w-full rounded-xl bg-amber-400 py-3 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40 cursor-pointer"
              disabled={trimmedName.length === 0}
              onClick={() => go('create')}
            >
              Create &amp; open lobby
            </button>
          </div>
        )}

        {panel === 'join' && (
          <div className="mt-3">
            <label htmlFor="code" className="block text-sm text-emerald-100">Room code</label>
            <input
              id="code"
              className="mt-1 min-h-11 w-full rounded-lg border border-emerald-600 bg-emerald-800 px-3 py-2 font-mono text-lg uppercase tracking-widest text-emerald-50"
              value={code}
              maxLength={8}
              autoCapitalize="characters"
              placeholder="ABCDEF"
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={code.length > 0 && !validCode}
            />
            <button
              className="mt-2 min-h-11 w-full rounded-xl bg-amber-400 py-3 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40 cursor-pointer"
              disabled={trimmedName.length === 0 || !validCode}
              onClick={() => go('join')}
            >
              Join
            </button>
            {code.length > 0 && !validCode && (
              <p className="mt-1 text-xs text-amber-300/80">Codes are 6 letters/numbers — check it and try again.</p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-emerald-300/60">
          In a room the rules are the host's, set in the lobby. Your display preferences travel with
          you:{' '}
          <button className="underline cursor-pointer" onClick={() => setShowSettings(true)}>
            open settings
          </button>
        </p>
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={onChangeSettings}
          onClose={() => setShowSettings(false)}
          scope="pre-game"
        />
      )}
    </div>
  )
}
