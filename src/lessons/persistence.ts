// Progress persistence: one versioned localStorage key with a migration
// path, plus export/import so progress survives a cleared cache.
// The API key NEVER goes through here — storage is for lesson progress and
// nothing secret.

import { emptyProgress, type ProgressState } from './mastery'

export const STORAGE_KEY = 'mahjong.progress.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Versioned migration: unknown/corrupt → null; partial v1 → backfilled. */
export function migrate(raw: unknown): ProgressState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Partial<ProgressState> & { version?: number }
  if (r.version !== 1) return null // future versions chain migrations here
  const base = emptyProgress()
  return {
    version: 1,
    concepts: typeof r.concepts === 'object' && r.concepts !== null ? r.concepts : base.concepts,
    xp: typeof r.xp === 'number' ? r.xp : 0,
    streak:
      r.streak && typeof r.streak.count === 'number'
        ? { count: r.streak.count, lastGoalDay: r.streak.lastGoalDay ?? null }
        : base.streak,
    today: r.today && typeof r.today.count === 'number' ? r.today : base.today,
    answers: Array.isArray(r.answers) ? r.answers : [],
    calibration: r.calibration ?? base.calibration,
  }
}

export function loadProgress(storage: StorageLike): ProgressState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    return migrate(JSON.parse(raw)) ?? emptyProgress()
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(storage: StorageLike, state: ProgressState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full or unavailable — the session continues in memory
  }
}

export const exportJSON = (state: ProgressState): string => JSON.stringify(state, null, 2)

export function importJSON(text: string): ProgressState | null {
  try {
    return migrate(JSON.parse(text))
  } catch {
    return null
  }
}
