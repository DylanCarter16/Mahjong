// Settings, in both modes (§B1).
//
// The split this file enforces: DISPLAY preferences are personal, local, and
// always changeable — including mid-game in multiplayer, where they used to be
// unreachable. They change what this device draws and nothing else: no message
// crosses the wire, no game state moves. RULES (faan minimum, flowers, bots)
// only appear in solo; in multiplayer they belong to the host and are locked
// once the game starts, so this panel shows where they live instead of
// pretending they are editable.

import type { Difficulty } from '../engine/bots'
import type { Seat } from '../engine/types'
import { SEAT_NAMES } from './panels'
import type { Settings } from './useGame'

const row = 'flex items-center justify-between gap-3 py-1.5'
const select = 'min-h-11 rounded bg-emerald-800 px-2 py-1 text-sm text-emerald-50 border border-emerald-600'
const check = 'h-6 w-6'

export type SettingsScope = 'pre-game' | 'solo' | 'multiplayer'

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  scope = 'solo',
  aidsAllowedByHost = true,
  onApplyNow,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  /**
   * 'pre-game'    — from the menu, before any game exists: rules here apply to
   *                 the very first hand you are dealt.
   * 'solo'        — mid-game: rules land on the next round (a hand can't have
   *                 its rules swapped underneath it), with onApplyNow as the
   *                 escape hatch.
   * 'multiplayer' — display preferences only; the host owns the rules.
   */
  scope?: SettingsScope
  /** House rule (§B2). False disables the personal aids toggle and says why. */
  aidsAllowedByHost?: boolean
  /** Solo mid-game: deal a fresh game now under the settings just chosen. */
  onApplyNow?: () => void
}) {
  const aidsOff = !aidsAllowedByHost
  const showRules = scope !== 'multiplayer'
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-80 max-w-full overflow-y-auto bg-emerald-950 border-l border-emerald-700 p-5 text-emerald-50"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Settings</h2>
          <button
            className="min-h-11 min-w-11 text-emerald-300 hover:text-white cursor-pointer"
            aria-label="Close settings"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {showRules && (
          <>
            <h3 className="mt-4 text-xs uppercase tracking-wide text-emerald-300/70">
              {scope === 'pre-game' ? 'Rules (applied when you start)' : 'Rules (next round)'}
            </h3>
            <div className={row}>
              <label htmlFor="faan-min">Minimum faan</label>
              <select
                id="faan-min"
                className={select}
                value={settings.faanMinimum}
                onChange={(e) => onChange({ ...settings, faanMinimum: Number(e.target.value) as 0 | 1 | 3 })}
              >
                <option value={0}>0 (family rules)</option>
                <option value={1}>1</option>
                <option value={3}>3 (default)</option>
              </select>
            </div>
            <div className={row}>
              <label htmlFor="flowers">Flowers &amp; seasons</label>
              <input
                id="flowers"
                type="checkbox"
                className={check}
                checked={settings.flowers}
                onChange={(e) => onChange({ ...settings, flowers: e.target.checked })}
              />
            </div>

            <h3 className="mt-4 text-xs uppercase tracking-wide text-emerald-300/70">
              {scope === 'pre-game' ? 'Bots' : 'Bots (next round)'}
            </h3>
            {([1, 2, 3] as Seat[]).map((seat) => (
              <div className={row} key={seat}>
                <label htmlFor={`diff-${seat}`}>{SEAT_NAMES[seat]}</label>
                <select
                  id={`diff-${seat}`}
                  className={select}
                  value={settings.difficulties[seat]}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      difficulties: { ...settings.difficulties, [seat]: e.target.value as Difficulty },
                    })
                  }
                >
                  <option value="easy">easy</option>
                  <option value="intermediate">intermediate</option>
                  <option value="advanced">advanced</option>
                </select>
              </div>
            ))}
          </>
        )}

        <h3 className="mt-4 text-xs uppercase tracking-wide text-emerald-300/70">Display (immediate)</h3>
        <p className="pb-1 text-xs text-emerald-300/60">
          Yours only — these change what this screen draws, never the game.
        </p>
        <div className={row}>
          <label htmlFor="numbered">Numbered tiles</label>
          <input
            id="numbered"
            type="checkbox"
            className={check}
            checked={settings.numberedTiles}
            onChange={(e) => onChange({ ...settings, numberedTiles: e.target.checked })}
          />
        </div>
        <div className={row}>
          <label htmlFor="aids" className={aidsOff ? 'text-emerald-300/50' : ''}>
            Beginner aids
            <span className="block text-xs text-emerald-300/60">Hint rings on your own tiles</span>
          </label>
          <input
            id="aids"
            type="checkbox"
            className={`${check} disabled:opacity-40`}
            checked={settings.beginnerAids && aidsAllowedByHost}
            disabled={aidsOff}
            onChange={(e) => onChange({ ...settings, beginnerAids: e.target.checked })}
          />
        </div>
        {aidsOff && (
          <p className="-mt-0.5 pb-1 text-xs text-amber-300/80">
            Turned off by the host for this room.
          </p>
        )}
        <div className={row}>
          <label htmlFor="reduce-motion">Reduce motion</label>
          <input
            id="reduce-motion"
            type="checkbox"
            className={check}
            checked={settings.reducedMotion}
            onChange={(e) => onChange({ ...settings, reducedMotion: e.target.checked })}
          />
        </div>

        <h3 className="mt-4 text-xs uppercase tracking-wide text-emerald-300/70">AI coach</h3>
        <div className="py-1.5">
          <label htmlFor="byo-key" className="block">Use my own API key <span className="text-emerald-400/60">(optional)</span></label>
          <input
            id="byo-key"
            type="password"
            autoComplete="off"
            placeholder="held in memory only"
            value={settings.byoKey}
            onChange={(e) => onChange({ ...settings, byoKey: e.target.value })}
            className="mt-1 min-h-11 w-full rounded border border-emerald-600 bg-emerald-800 px-2 py-1 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-emerald-300/60">
            Skips the shared rate limit. Never saved, never logged — it lives in this tab's memory only.
          </p>
        </div>

        {scope === 'solo' && onApplyNow && (
          <div className="mt-4 rounded-lg border border-emerald-800 bg-emerald-900/40 p-3">
            <p className="text-xs text-emerald-300/70">
              Rule and bot changes land on the next round — a hand can't have its rules swapped
              halfway through. If you want them now:
            </p>
            <button
              className="mt-2 min-h-11 w-full rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
              onClick={onApplyNow}
            >
              Deal a new game with these rules
            </button>
            <p className="mt-1 text-xs text-emerald-300/50">Abandons the current hand and resets the score.</p>
          </div>
        )}

        <p className="mt-3 text-xs text-emerald-300/60">
          {scope === 'pre-game'
            ? 'These apply to the next game you start. Display preferences apply everywhere, immediately.'
            : scope === 'solo'
              ? 'Rule and bot changes take effect when the next round is dealt.'
              : 'House rules (faan minimum, flowers, timers, coach) are set by the host in the lobby and locked for the game.'}
        </p>
      </div>
    </div>
  )
}
