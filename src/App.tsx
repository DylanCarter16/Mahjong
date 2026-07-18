import { useEffect, useState } from 'react'
import { LessonScreen } from './lessons/LessonScreen'
import { GalleryScreen } from './ui/GalleryScreen'
import { PlayHub } from './ui/PlayHub'
import { TileDefs } from './ui/tiles/TileFace'
import { defaultSettings, type Settings } from './ui/useGame'

type Tab = 'play' | 'learn'

const tabCls = (active: boolean) =>
  `px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
    active ? 'bg-amber-400 text-amber-950' : 'text-emerald-200 hover:bg-emerald-800'
  }`

export default function App() {
  const [tab, setTab] = useState<Tab>('play')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Static design-gate page: /#/gallery
  if (hash === '#/gallery') return <GalleryScreen />

  // Play keeps the felt (emerald) surface; the lessons live on the calmer
  // paper surface they were designed for.
  return (
    <div
      className={`min-h-screen text-emerald-50 ${
        tab === 'play' ? 'bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950' : 'bg-paper'
      }`}
    >
      <TileDefs />
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
        {tab === 'play' ? <PlayHub settings={settings} onChangeSettings={setSettings} /> : <LessonScreen />}
      </main>
    </div>
  )
}
