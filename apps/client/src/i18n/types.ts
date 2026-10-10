// Shared i18n types. A catalog entry carries one string per supported language;
// English is the guaranteed fallback (translate() degrades to it, then to the
// raw key, so a missing translation never crashes or blanks the UI).

import type { Language } from '../stores/settings.js'

/**
 * English and Russian are authored inline next to each key; later languages are
 * merged in from a single per-language file (see ./sinhala.ts) so a native
 * proofreader edits one document instead of nineteen. translate() falls back to
 * English per key, so a half-finished language never blanks the UI.
 */
export type Entry = { en: string; ru: string } & Partial<Record<Language, string>>

/** A slice of the catalog owned by one screen/area; merged in catalog.ts. */
export type Strings = Record<string, Entry>
