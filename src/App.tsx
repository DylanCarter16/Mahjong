import { useEffect, useState } from 'react'
import { LessonScreen } from './lessons/LessonScreen'
import { GalleryScreen } from './ui/GalleryScreen'
import { GameScreen } from './ui/GameScreen'
import { TileDefs } from './ui/tiles/TileFace'
import { defaultSettings, type Settings } from './ui/useGame'

type Tab = 'play' | 'learn'

const tabCls = (active: boolean) =>
  `px-4 py-1.5 rounded-full text-sm font-semibold transition-colors duration-(--duration-ui) cursor-pointer ${
    active ? 'bg-accent text-on-accent' : 'text-parchment-dim hover:bg-felt-light/60 hover:text-parchment'
  }`

export default function App() {
  const [tab, setTab] = useState<Tab>('play')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [completedUnits, setCompletedUnits] = useState<Set<number>>(new Set())
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Static design-gate page: /#/gallery
  if (hash === '#/gallery') return <GalleryScreen />

  return (
    <div className={`min-h-screen ${tab === 'play' ? 'felt-surface' : 'bg-paper'}`}>
      <TileDefs />
      <nav className="relative z-10 flex items-center gap-3 px-4 pt-4">
        <h1 className="mr-2 font-serif text-lg font-bold tracking-tight text-parchment">
          Mahjong <span className="font-sans text-sm font-normal text-parchment-dim">play + learn</span>
        </h1>
        <button className={tabCls(tab === 'play')} onClick={() => setTab('play')}>
          Play
        </button>
        <button className={tabCls(tab === 'learn')} onClick={() => setTab('learn')}>
          Learn
        </button>
      </nav>
      <main className="relative z-10 mx-auto max-w-6xl">
        {tab === 'play' ? (
          <GameScreen settings={settings} onChangeSettings={setSettings} />
        ) : (
          <LessonScreen
            completed={completedUnits}
            onCompleteUnit={(id) => setCompletedUnits((s) => new Set(s).add(id))}
          />
        )}
      </main>
    </div>
  )
}
