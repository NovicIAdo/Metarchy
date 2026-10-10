// Lightweight, dependency-free i18n. Strings live in a flat dotted-key catalog
// (see ./catalog.ts), language is the persisted settings value, and English is
// the fallback. `useT()` subscribes to the language so a switch re-renders every
// consumer; `t()` is the non-reactive accessor for code outside React.

import { useSettingsStore, type Language } from '../stores/settings.js'
import { catalog } from './catalog.js'

export type Vars = Record<string, string | number>

export function translate(lang: Language, key: string, vars?: Vars): string {
  const entry = catalog[key]
  let s = entry ? (entry[lang] ?? entry.en) : key
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

export type TFunction = (key: string, vars?: Vars) => string

/** Reactive translator: re-renders the caller when the language changes. */
export function useT(): TFunction {
  const lang = useSettingsStore((s) => s.language)
  return (key, vars) => translate(lang, key, vars)
}

/** One-shot translation outside React render (toasts, imperative code). */
export function t(key: string, vars?: Vars): string {
  return translate(useSettingsStore.getState().language, key, vars)
}
