// The full rulebook, surfaced in-app GitBook-style: a section sidebar on the left
// and the selected page on the right, with prev/next paging. The sources are the
// canonical docs/metarchy-rules{,.ru}.md, synced into src/content by
// scripts/sync-rules.ts (a test guards the copies). Language follows the settings
// store; reachable from Home and the sign-in screen (rules readable pre-account).

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Markdown } from '../components/Markdown.js'
import rulebookEn from '../content/rulebook.en.md?raw'
import rulebookRu from '../content/rulebook.ru.md?raw'
import rulebookSi from '../content/rulebook.si.md?raw'
import { flattenPages, parseRulebook } from '../lib/rulebook.js'
import { LANGUAGES, useSettingsStore } from '../stores/settings.js'
import { themeAsset } from '../theme.js'

const T = {
  en: {
    back: '← Back',
    howToPlay: 'How to Play',
    prev: '← Previous',
    next: 'Next →',
    overview: 'Overview'
  },
  ru: {
    back: '← Назад',
    howToPlay: 'Обучение',
    prev: '← Назад',
    next: 'Дальше →',
    overview: 'Обзор'
  },
  si: {
    back: '← ආපසු',
    howToPlay: 'සෙල්ලම් කරන ආකාරය',
    prev: '← පෙර',
    next: 'ඊළඟ →',
    overview: 'දළ විශ්ලේෂණය'
  }
}

/** Each language ships its own rulebook file; a missing one falls back to English. */
const RULEBOOKS: Record<string, string> = {
  en: rulebookEn,
  ru: rulebookRu,
  si: rulebookSi
}

export function RulesScreen() {
  const navigate = useNavigate()
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const t = T[language]

  const parts = useMemo(
    () => parseRulebook(RULEBOOKS[language] ?? rulebookEn, t.overview),
    [language, t.overview]
  )
  const pages = useMemo(() => flattenPages(parts), [parts])
  const [pageId, setPageId] = useState(pages[0]?.id ?? '')
  // Language swap re-parses into new ids — fall back to the first page.
  const current = pages.find((p) => p.id === pageId) ?? pages[0]
  const index = current ? pages.indexOf(current) : 0
  const [navOpen, setNavOpen] = useState(false)

  const go = (id: string) => {
    setPageId(id)
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="screen">
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />
      <div className="panel doc-panel">
        <div className="doc-actions">
          <button className="btn secondary" onClick={() => navigate(-1)}>
            {t.back}
          </button>
          <div className="lang-toggle">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                className={`lang-btn ${language === l.id ? 'active' : ''}`}
                onClick={() => setLanguage(l.id)}
                title={l.label}
              >
                {l.short}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => navigate('/tutorial')}>
            {t.howToPlay}
          </button>
        </div>

        <button className="btn secondary rules-nav-toggle" onClick={() => setNavOpen((v) => !v)}>
          ☰ {current?.title ?? ''}
        </button>

        <div className="rules-layout">
          <nav className={`rules-nav ${navOpen ? 'open' : ''}`}>
            {parts.map((part) => (
              <div key={part.title} className="rules-nav-part">
                <div className="rules-nav-parttitle">{part.title}</div>
                {part.items.map((item, idx) =>
                  item.kind === 'label' ? (
                    <div key={`l${idx}`} className="rules-nav-label">
                      {item.title}
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      className={`rules-nav-page ${item.sub ? 'sub' : ''} ${
                        item.id === current?.id ? 'active' : ''
                      }`}
                      onClick={() => go(item.id)}
                    >
                      {item.title}
                    </button>
                  )
                )}
              </div>
            ))}
          </nav>

          <article className="rules-content">
            {current && (
              <>
                <h2 className="rules-page-title">{current.title}</h2>
                <Markdown source={current.body} />
              </>
            )}
            <div className="doc-actions">
              <button
                className="btn secondary"
                disabled={index <= 0}
                onClick={() => pages[index - 1] && go(pages[index - 1]!.id)}
              >
                {t.prev}
              </button>
              <button
                className="btn"
                disabled={index >= pages.length - 1}
                onClick={() => pages[index + 1] && go(pages[index + 1]!.id)}
              >
                {t.next}
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}
