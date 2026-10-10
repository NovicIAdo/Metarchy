// Player-local settings, persisted in localStorage. Volume knobs are stored
// now and take effect when the audio system ships; language carries one live
// option until localization lands.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'ru' | 'si'
/**
 * Each language names itself — a player hunting for their own tongue reads it,
 * and never has to know the ISO code. `short` is the pill-switch form: an
 * uppercased id would read "SI" to a Sinhala speaker, which is not their word.
 */
export const LANGUAGES: { id: Language; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ru', label: 'Русский', short: 'RU' },
  { id: 'si', label: 'සිංහල', short: 'සිං' }
]

export interface SettingsStore {
  /** Live UI language: the whole client, the rulebook and the tutorial. */
  language: Language
  /** ThemeManifest id (art style, author backlog). Applied at boot in main.tsx. */
  artTheme: string
  /** 0–100; applied once the audio system exists. */
  musicVolume: number
  sfxVolume: number
  /** Gates native "your turn" push registration. */
  notifications: boolean
  setLanguage(lang: Language): void
  setArtTheme(id: string): void
  setMusicVolume(v: number): void
  setSfxVolume(v: number): void
  setNotifications(on: boolean): void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      language: 'en',
      artTheme: 'cyberpunk',
      musicVolume: 70,
      sfxVolume: 80,
      notifications: true,
      setLanguage: (language) => set({ language }),
      setArtTheme: (artTheme) => set({ artTheme }),
      setMusicVolume: (musicVolume) => set({ musicVolume }),
      setSfxVolume: (sfxVolume) => set({ sfxVolume }),
      setNotifications: (notifications) => set({ notifications })
    }),
    { name: 'metarchy.settings' }
  )
)
