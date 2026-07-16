import { useCallback, useState } from 'react'
import type { ProgressState } from './mastery'
import { exportJSON, importJSON, loadProgress, saveProgress } from './persistence'

/** Progress lives in localStorage under one versioned key (§4.2). */
export function useProgress() {
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress(window.localStorage))

  const update = useCallback((fn: (s: ProgressState) => ProgressState) => {
    setProgress((s) => {
      const next = fn(s)
      saveProgress(window.localStorage, next)
      return next
    })
  }, [])

  const exportProgress = useCallback(() => {
    const blob = new Blob([exportJSON(loadProgress(window.localStorage))], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mahjong-progress.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const importProgress = useCallback(
    (text: string): boolean => {
      const parsed = importJSON(text)
      if (!parsed) return false
      saveProgress(window.localStorage, parsed)
      setProgress(parsed)
      return true
    },
    [],
  )

  return { progress, update, exportProgress, importProgress }
}
