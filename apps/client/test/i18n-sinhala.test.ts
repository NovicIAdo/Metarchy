// Sinhala (සිංහල) ships as one key→string map merged onto the authored en/ru
// entries. Two things can silently rot in that arrangement: a key can go
// untranslated (the UI quietly falls back to English), and a translated string
// can lose a {placeholder} (the UI then prints a literal "{n}" at a player).
// Both fail here instead of in front of a Sri Lankan player.

import { describe, expect, it } from 'vitest'
import { catalog } from '../src/i18n/catalog.js'
import { sinhala } from '../src/i18n/sinhala.js'
import { translate } from '../src/i18n/index.js'
import { LANGUAGES } from '../src/stores/settings.js'

const placeholders = (s: string): string[] => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort()

describe('Sinhala catalog', () => {
  it('is offered in the language switcher', () => {
    expect(LANGUAGES.map((l) => l.id)).toContain('si')
    // Named in its own script — that is how a player finds their language.
    expect(LANGUAGES.find((l) => l.id === 'si')?.label).toBe('සිංහල')
  })

  it('covers every catalog key', () => {
    const missing = Object.keys(catalog).filter((k) => !catalog[k]?.si)
    expect(missing, `untranslated keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('carries no keys the catalog dropped', () => {
    const stale = Object.keys(sinhala).filter((k) => !catalog[k])
    expect(stale, `stale keys:\n${stale.join('\n')}`).toEqual([])
  })

  it('keeps every {placeholder} the English string has', () => {
    const broken: string[] = []
    for (const [key, entry] of Object.entries(catalog)) {
      if (!entry.si) continue
      const want = placeholders(entry.en)
      const got = placeholders(entry.si)
      if (want.join(',') !== got.join(',')) broken.push(`${key}: en ${want} vs si ${got}`)
    }
    expect(broken, `placeholder drift:\n${broken.join('\n')}`).toEqual([])
  })

  it('is actually in Sinhala script, and substitutes like any other language', () => {
    // A copy-paste of the English would satisfy every check above.
    const sinhalaScript = /[඀-෿]/
    const latinOnly = Object.entries(catalog).filter(
      ([, e]) => e.si && !sinhalaScript.test(e.si) && /[a-zA-Z]{4}/.test(e.si)
    )
    // A handful of proper nouns (Metarchy, GATO, EN/RU) legitimately stay Latin.
    expect(latinOnly.length, latinOnly.map(([k]) => k).join(', ')).toBeLessThan(12)
    expect(translate('si', 'game.hud.turnOf', { n: 2, max: 5 })).toContain('2')
    // An unknown key still degrades to the key itself, never to a crash.
    expect(translate('si', 'no.such.key')).toBe('no.such.key')
  })
})
