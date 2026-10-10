// Shared top bar: back + connection status on the LEFT, the language switch and
// the account button on the RIGHT (the account is the far-right corner). The
// account shows a round avatar chip next to the nickname so it reads as a
// tappable way into your profile — where Log Out lives.
//
// Every submenu screen mounts this bar, so "back" is always reachable at the
// top — long screens (rules, past games) must not force a scroll to the bottom
// back button. Nested viewers return to their list, everything else to Home.

import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../i18n/index.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'
import { LangToggle } from './LangToggle.js'

function backTarget(pathname: string): string | null {
  if (pathname === '/') return null
  if (pathname.startsWith('/replay/')) return '/replays'
  if (pathname.startsWith('/watch/')) return '/watch'
  return '/'
}

export function TopBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const t = useT()
  const userId = useSessionStore((s) => s.userId)
  const profile = useSessionStore((s) => s.profile)
  const socketStatus = useSessionStore((s) => s.socketStatus)
  const avatar = profile?.avatar ?? null
  const backTo = backTarget(pathname)

  return (
    <div className="topbar">
      <div className="topbar-left">
        {backTo !== null && (
          <button type="button" className="topbar-back" onClick={() => navigate(backTo)}>
            {t('common.back')}
          </button>
        )}
        {userId !== null && (
          <span className="status-chip" aria-live="polite">
            <span className={`status-dot ${socketStatus}`} />
            {t(`status.${socketStatus}`)}
          </span>
        )}
      </div>

      <div className="topbar-right">
        <LangToggle />
        {userId !== null && (
          <button
            type="button"
            className="account-chip"
            onClick={() => navigate('/profile')}
            title={t('topbar.openAccount')}
            aria-label={t('topbar.openAccount')}
          >
            {avatar ? (
              <img className="avatar-chip" src={themeAsset(`avatar.${avatar}`)} alt="" />
            ) : (
              <span className="avatar-chip placeholder" aria-hidden="true">
                {profile?.nickname?.[0]?.toUpperCase() ?? '•'}
              </span>
            )}
            <span className="nickname">{profile?.nickname ?? '…'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
