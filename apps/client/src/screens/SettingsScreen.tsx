// Settings: language, art style, audio volumes, notifications. Art style
// switches between installed ThemeManifests (author backlog — futurism first,
// other styles later); notifications gate the push tokens; volumes persist for
// the future audio system; language switches the whole UI live.

import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { LANGUAGES, useSettingsStore } from '../stores/settings.js'
import { themeAsset, themes } from '../theme.js'

export function SettingsScreen() {
  const navigate = useNavigate()
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const artTheme = useSettingsStore((s) => s.artTheme)
  const musicVolume = useSettingsStore((s) => s.musicVolume)
  const sfxVolume = useSettingsStore((s) => s.sfxVolume)
  const notifications = useSettingsStore((s) => s.notifications)
  const setArtTheme = useSettingsStore((s) => s.setArtTheme)
  const setMusicVolume = useSettingsStore((s) => s.setMusicVolume)
  const setSfxVolume = useSettingsStore((s) => s.setSfxVolume)
  const setNotifications = useSettingsStore((s) => s.setNotifications)

  function switchArtTheme(id: string) {
    if (id === artTheme) return
    setArtTheme(id)
    // Textures are cached by URL all over Pixi and the DOM — a reload is the
    // honest way to reskin everything; the socket resumes any active game.
    window.location.reload()
  }

  function toggleNotifications() {
    const next = !notifications
    setNotifications(next)
    // Off deletes every device token server-side — pushes stop everywhere.
    // On re-registers on the next native session (native/push.ts).
    if (!next && online) gameSocket.unregisterPush()
  }

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel">
        <h2>{t('settings.title')}</h2>

        <div className="field">
          <label htmlFor="language">{t('settings.language')}</label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number]['id'])}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint-text">{t('settings.langHint')}</p>

        <div className="field">
          <label htmlFor="theme">{t('settings.artStyle')}</label>
          <select id="theme" value={artTheme} onChange={(e) => switchArtTheme(e.target.value)}>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </div>
        {themes.length === 1 && <p className="hint-text">{t('settings.moreArtStyles')}</p>}

        <div className="field">
          <label htmlFor="music">{t('settings.music', { n: musicVolume })}</label>
          <input
            id="music"
            type="range"
            min={0}
            max={100}
            value={musicVolume}
            onChange={(e) => setMusicVolume(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="sfx">{t('settings.sfx', { n: sfxVolume })}</label>
          <input
            id="sfx"
            type="range"
            min={0}
            max={100}
            value={sfxVolume}
            onChange={(e) => setSfxVolume(Number(e.target.value))}
          />
        </div>
        <p className="hint-text">{t('settings.volumeHint')}</p>

        <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
          <p className="hint-text" style={{ flex: 1, margin: 0 }}>
            {t('settings.turnNotifications')}
          </p>
          <button
            className={`btn ${notifications ? 'confirm' : 'secondary'}`}
            style={{ width: 'auto', flex: 'none' }}
            onClick={toggleNotifications}
          >
            {notifications ? t('settings.on') : t('settings.off')}
          </button>
        </div>
        {!notifications && <p className="hint-text">{t('settings.pushOffHint')}</p>}
      </div>

      <button className="btn secondary" style={{ maxWidth: 440 }} onClick={() => navigate('/')}>
        {t('common.back')}
      </button>
    </div>
  )
}
