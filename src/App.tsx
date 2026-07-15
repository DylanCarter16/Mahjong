import { useState } from 'react'
import { GameScreen } from './ui/GameScreen'
import { defaultSettings, type Settings } from './ui/useGame'

type Tab = 'play' | 'learn'

const tabCls = (active: boolean) =>
  `px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
    active ? 'bg-amber-400 text-amber-950' : 'text-emerald-200 hover:bg-emerald-800'
  }`

export default function App() {
  const [tab, setTab] = useState<Tab>('play')
  const [settings, setSettings] = useState<Settings>(defaultSettings)

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-emerald-50">
      <nav className="flex items-center gap-3 px-4 pt-4">
        <h1 className="mr-2 text-lg font-bold tracking-tight">
          🀄 Mahjong <span className="font-normal text-emerald-300/70">play + learn</span>
        </h1>
        <button className={tabCls(tab === 'play')} onClick={() => setTab('play')}>
          Play
        </button>
        <button className={tabCls(tab === 'learn')} onClick={() => setTab('learn')}>
          Learn
        </button>
      </nav>
      <main className="mx-auto max-w-6xl">
        {tab === 'play' ? (
          <GameScreen settings={settings} onChangeSettings={setSettings} />
        ) : (
          <div className="grid place-items-center py-24 text-emerald-300/70">
            Lessons are coming in the next build step.
          </div>
        )}
      </main>
    </div>
  )
}
