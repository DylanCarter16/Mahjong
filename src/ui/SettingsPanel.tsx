import type { Difficulty } from '../engine/bots'
import type { Seat } from '../engine/types'
import { CloseIcon } from './icons'
import { SEAT_NAMES } from './panels'
import type { Settings } from './useGame'

const row = 'flex items-center justify-between gap-3 py-1.5'
const select = 'rounded-lg bg-felt-light px-2 py-1 text-sm text-parchment border border-felt-line'
const heading = 'mt-4 text-xs uppercase tracking-wide text-parchment-dim'

export function SettingsPanel({ settings, onChange, onClose }: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-80 overflow-y-auto border-l border-felt-line bg-felt-deep p-5 text-parchment shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-bold">Settings</h2>
          <button className="cursor-pointer text-parchment-dim hover:text-parchment" onClick={onClose} aria-label="close settings">
            <CloseIcon />
          </button>
        </div>

        <h3 className={heading}>Rules (next round)</h3>
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
            checked={settings.flowers}
            onChange={(e) => onChange({ ...settings, flowers: e.target.checked })}
          />
        </div>

        <h3 className={heading}>Bots (next round)</h3>
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

        <h3 className={heading}>Display (immediate)</h3>
        <div className={row}>
          <label htmlFor="numbered">Rank overlay on tiles</label>
          <input
            id="numbered"
            type="checkbox"
            checked={settings.numberedTiles}
            onChange={(e) => onChange({ ...settings, numberedTiles: e.target.checked })}
          />
        </div>
        <div className={row}>
          <label htmlFor="aids">Beginner aids</label>
          <input
            id="aids"
            type="checkbox"
            checked={settings.beginnerAids}
            onChange={(e) => onChange({ ...settings, beginnerAids: e.target.checked })}
          />
        </div>

        <h3 className={heading}>AI coach</h3>
        <div className="py-1.5">
          <label htmlFor="byo-key" className="block">
            Use my own API key <span className="text-parchment-dim">(optional)</span>
          </label>
          <input
            id="byo-key"
            type="password"
            autoComplete="off"
            placeholder="held in memory only"
            value={settings.byoKey}
            onChange={(e) => onChange({ ...settings, byoKey: e.target.value })}
            className="mt-1 w-full rounded-lg border border-felt-line bg-felt-light px-2 py-1 font-mono text-sm placeholder:text-parchment-dim/60"
          />
          <p className="mt-1 text-xs text-parchment-dim">
            Skips the shared rate limit. Never saved, never logged — it lives in this tab's memory only.
          </p>
        </div>
        <p className="mt-3 text-xs text-parchment-dim">
          Rule and bot changes take effect when the next round is dealt.
        </p>
      </div>
    </div>
  )
}
