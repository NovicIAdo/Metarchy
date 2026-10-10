// The language pill switch. One instance lives in the shared TopBar (top-right
// corner); the rules/tutorial readers reuse it inline too. Each chip carries the
// language's own short name, so a player recognises theirs without reading a
// code — the full name rides along as the title for anyone who needs it.

import { LANGUAGES, useSettingsStore } from '../stores/settings.js'

export function LangToggle() {
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`lang-btn ${language === l.id ? 'active' : ''}`}
          aria-pressed={language === l.id}
          onClick={() => setLanguage(l.id)}
          title={l.label}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}
