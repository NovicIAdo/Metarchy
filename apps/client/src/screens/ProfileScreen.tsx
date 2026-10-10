// The account cabinet: nickname/avatar, actor skins, argument coins, security (password, TOTP
// 2FA, passkeys), wallet linking and recent games. The shared nickname
// validator gives instant feedback; the server still decides — only it knows
// what's taken. Skins/wallet are staging posts for the shop and the
// chain-agnostic blockchain layer (plan/Blockchain-Integration.md).

import type { ActorType } from '@metarchy/engine'
import { ACTOR_TYPES } from '@metarchy/engine'
import type {
  AchievementState,
  ActorLoadout,
  ArgSkinId,
  AvatarId,
  HistoryEntry,
  ModeRecord,
  Skins,
  Wardrobe
} from '@metarchy/protocol'
import {
  ARG_SKIN_IDS,
  AVATAR_IDS,
  MARKET_CATEGORIES,
  NICKNAME_MAX,
  NICKNAME_MIN,
  POLITICIAN_PACK,
  RECORD_CATEGORIES,
  SKIN_CATALOG,
  argSkinFor,
  argSkinItemId,
  avatarItemId,
  categoryOfItem,
  emptyModeRecord,
  isExclusiveSkin,
  isFreeAvatar,
  isTradable,
  loadoutFor,
  nicknameIssueOf,
  skinFor,
  skinItemId,
  validateNickname,
  winRate
} from '@metarchy/protocol'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AchievementsPanel } from '../components/AchievementsPanel.js'
import { AddEmailLogin, SolanaAccountPanel } from '../components/SolanaAccountPanel.js'
import { ActorArt } from '../components/ActorArt.js'
import { CoinSet } from '../components/CoinSet.js'
import { TopBar } from '../components/TopBar.js'
import type { WalletState } from '../hooks/useWallet.js'
import { useWallet } from '../hooks/useWallet.js'
import { useDomain } from '../i18n/domain.js'
import { ARG_SET_NAME_KEYS, SKIN_NAME_KEYS } from '../lib/cosmetics.js'
import { ItemArt, itemName } from '../lib/itemDisplay.jsx'
import { CATEGORY_LABEL_KEYS } from './MarketScreen.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { supabase } from '../supabase.js'
import { themeAsset } from '../theme.js'

function HistoryRow({
  entry,
  onToggleStar
}: {
  entry: HistoryEntry
  onToggleStar: (entry: HistoryEntry) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const verdict = entry.status === 'aborted' ? 'aborted' : entry.result === 'win' ? 'win' : 'loss'
  const delta =
    entry.ratingBefore !== null && entry.ratingAfter !== null
      ? Math.round(entry.ratingAfter) - Math.round(entry.ratingBefore)
      : null
  const date = entry.finishedAt
    ? new Date(entry.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  return (
    <li className={`history-row ${verdict}`}>
      {/* Like PAST GAMES: the strip opens the replay, the star marks it for
          later study. Star is its own button so it never triggers the strip. */}
      <button
        type="button"
        className={entry.starred ? 'star-btn active' : 'star-btn'}
        aria-pressed={entry.starred}
        title={t(entry.starred ? 'replay.unstar' : 'replay.star')}
        aria-label={t(entry.starred ? 'replay.unstar' : 'replay.star')}
        onClick={() => onToggleStar(entry)}
      >
        {entry.starred ? '★' : '☆'}
      </button>
      <button
        type="button"
        className="history-open"
        onClick={() => navigate(`/replay/${entry.gameId}`)}
      >
        <span className={`history-verdict ${verdict}`}>
          {entry.status === 'aborted'
            ? '—'
            : t(entry.result === 'win' ? 'profile.verdictWin' : 'profile.verdictLoss')}
        </span>
        <span className="history-mode">{t('mode.' + entry.mode)}</span>
        <span className="history-detail">
          {entry.finalVp !== null ? `${entry.finalVp} ${t('profile.vp')}` : ''}
          {delta !== null ? ` · ${delta >= 0 ? '+' : ''}${delta}` : ''}
        </span>
        <span className="history-date">{date}</span>
      </button>
    </li>
  )
}

/**
 * Games / wins / losses / win rate per category, aggregated by the server over
 * the player's whole archive (the Recent-games list below is capped, so it is
 * NOT what these numbers are counted from).
 */
/** Shared with the public profile of another player (PlayerScreen). */
export function RecordPanel({ record }: { record: ModeRecord | null }) {
  const t = useT()
  if (!record) return <p className="hint-text">{t('common.loading')}</p>
  // The three categories the author asked for always show, zero included — "no
  // ranked games yet" is information. Public 2v2 is unrated and today cannot
  // even be matchmade (invite-only), so its row appears only once one exists.
  const rows = RECORD_CATEGORIES.filter((c) => c !== 'team' || record.team.played > 0)
  return (
    <>
      <ul className="record-table">
        <li className="record-row record-head">
          <span className="record-cat">{t('profile.record.category')}</span>
          <span className="record-num">{t('profile.record.played')}</span>
          <span className="record-num">{t('profile.record.wins')}</span>
          <span className="record-num">{t('profile.record.losses')}</span>
          <span className="record-rate">{t('profile.record.rate')}</span>
        </li>
        {rows.map((category) => {
          const row = record[category]
          const rate = winRate(row)
          return (
            <li key={category} className="record-row">
              <span className="record-cat">{t(`profile.record.${category}`)}</span>
              <span className="record-num">{row.played}</span>
              <span className="record-num win">{row.wins}</span>
              <span className="record-num loss">{row.losses}</span>
              {/* No games = no rate: a dash, never a 0/0 division. */}
              <span className="record-rate">{rate === null ? '—' : `${rate}%`}</span>
            </li>
          )
        })}
      </ul>
      <p className="hint-text">{t('profile.record.blurb')}</p>
    </>
  )
}

function PasswordSection() {
  const t = useT()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wrongCurrent, setWrongCurrent] = useState(false)
  const [done, setDone] = useState(false)

  async function change() {
    setBusy(true)
    setError(null)
    setWrongCurrent(false)
    setDone(false)
    try {
      // Re-authenticate first: a session that stayed logged in on a shared
      // machine must not be enough to change the password — only someone who
      // knows the CURRENT one may set a new one. signInWithPassword validates
      // it server-side and refuses a wrong one with invalid_credentials.
      const email = (await supabase.auth.getUser()).data.user?.email
      if (!email) throw new Error('No signed-in account.')
      const { error: reauth } = await supabase.auth.signInWithPassword({ email, password: current })
      if (reauth) {
        setWrongCurrent(true)
        return
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      setCurrent('')
      setPassword('')
      setConfirm('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const mismatch = confirm.length > 0 && confirm !== password
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void change()
      }}
    >
      <p className="hud-label">{t('profile.changePassword')}</p>
      <div className="field">
        <label htmlFor="current-password">{t('profile.currentPassword')}</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value)
            setWrongCurrent(false)
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">{t('profile.newPassword')}</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">{t('profile.repeatPassword')}</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <button
        className="btn"
        type="submit"
        disabled={busy || current.length === 0 || password.length < 8 || password !== confirm}
      >
        {t('profile.updatePassword')}
      </button>
      <p className="error-text">
        {wrongCurrent
          ? t('profile.passwordWrong')
          : (error ?? (mismatch ? t('profile.passwordsDiffer') : null))}
      </p>
      {done && <p className="hint-text">{t('profile.passwordUpdated')}</p>}
    </form>
  )
}

type TotpFactor = { id: string; status: string; friendlyName?: string }

function TotpSection() {
  const t = useT()
  const [factors, setFactors] = useState<TotpFactor[] | null>(null)
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(
    null
  )
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) setError(error.message)
    else setFactors(data.totp)
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function beginEnroll() {
    setBusy(true)
    setError(null)
    try {
      // Abandoned unverified factors block re-enrollment — sweep them first.
      for (const f of factors ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (error) throw error
      setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll() {
    if (!enrolling) return
    setBusy(true)
    setError(null)
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrolling.id
      })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrolling.id,
        challengeId: challenge.id,
        code: code.trim()
      })
      if (verifyError) throw verifyError
      setEnrolling(null)
      setCode('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function drop(factorId: string) {
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const active = (factors ?? []).filter((f) => f.status === 'verified')

  return (
    <div style={{ marginTop: 14 }}>
      <p className="hud-label">{t('profile.twoFactor')}</p>
      {factors === null && <p className="hint-text">{t('common.loading')}</p>}
      {factors !== null && active.length === 0 && !enrolling && (
        <>
          <p className="hint-text">{t('profile.addAuthenticator')}</p>
          <button className="btn" disabled={busy} onClick={() => void beginEnroll()}>
            {t('profile.enable2fa')}
          </button>
        </>
      )}
      {active.map((f) => (
        <div key={f.id} className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <p className="hint-text" style={{ flex: 1, margin: 0 }}>
            ✓ {t('profile.authenticatorEnabled')}
          </p>
          <button
            className="btn danger"
            style={{ width: 'auto', flex: 'none' }}
            disabled={busy}
            onClick={() => void drop(f.id)}
          >
            {t('profile.disable')}
          </button>
        </div>
      ))}
      {enrolling && (
        <div className="mfa-enroll">
          <p className="hint-text">{t('profile.scanQr')}</p>
          <img className="mfa-qr" src={enrolling.qr} alt={t('profile.qrAlt')} />
          <p className="mfa-secret">{enrolling.secret}</p>
          <div className="row">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="btn confirm"
              style={{ flex: 'none', width: 'auto' }}
              disabled={busy || code.trim().length < 6}
              onClick={() => void confirmEnroll()}
            >
              ✓ {t('profile.verify')}
            </button>
            <button
              className="btn reject"
              style={{ flex: 'none', width: 'auto' }}
              disabled={busy}
              onClick={() => {
                void supabase.auth.mfa.unenroll({ factorId: enrolling.id })
                setEnrolling(null)
                setCode('')
              }}
            >
              ✕ {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      <p className="error-text">{error}</p>

      <p className="hud-label" style={{ marginTop: 14 }}>
        {t('profile.passkeys')}
      </p>
      <p className="hint-text">{t('profile.passkeysSoon')}</p>
    </div>
  )
}

/** Chain family stubs — the data model is chain-agnostic (EVM/Solana/Cosmos);
    each adapter ships as its own integration (plan/Blockchain-Integration.md). */
const WALLET_FAMILIES = ['EVM', 'Cosmos'] as const

function WalletSection({ wallet }: { wallet: WalletState | null }) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <>
      <div className="gato-balance-row">
        <img className="gato-coin" src={themeAsset('currency.gato')} alt="" />
        <span className="gato-amount">
          {wallet ? t('profile.gatoBalance', { n: wallet.balance }) : '…'}
        </span>
        <button className="btn secondary" onClick={() => navigate('/shop')}>
          {t('profile.toShop')}
        </button>
      </div>
      <p className="hint-text">{t('profile.gatoOwned', { n: wallet?.owned.length ?? 0 })}</p>
      <SolanaAccountPanel />
      <div className="row">
        {WALLET_FAMILIES.map((family) => (
          <button key={family} className="btn secondary" disabled title={t('profile.comingSoon')}>
            {family}
          </button>
        ))}
      </div>
    </>
  )
}

const COSTUME_KEYS = ['profile.costume.cape', 'profile.costume.coat', 'profile.costume.gown']
const ACCESSORY_KEYS = [
  'profile.accessory.glasses',
  'profile.accessory.visor',
  'profile.accessory.mask',
  'profile.accessory.respirator'
]

function oneTo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1)
}

function Chips({
  options,
  chosen,
  onPick
}: {
  options: { id: number | null; name: string }[]
  chosen: number | null
  onPick: (id: number | null) => void
}) {
  return (
    <div className="wardrobe-options">
      {options.map((o) => (
        <button
          key={o.id ?? 'none'}
          type="button"
          className={`wardrobe-chip ${chosen === o.id ? 'chosen' : ''}`}
          onClick={() => onPick(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

const numbered = (n: number) => oneTo(n).map((i) => ({ id: i as number | null, name: String(i) }))
const withNone = (n: number, noneLabel: string) => [{ id: null, name: noneLabel }, ...numbered(n)]

/**
 * The fitting room. Draft state is local; Save sends the whole politician
 * loadout (profile.update merges per actor, null restores the canonical art).
 */
function PoliticianFitting({
  initial,
  wardrobe,
  onClose
}: {
  initial: ActorLoadout | null
  wardrobe: Wardrobe | null
  onClose: () => void
}) {
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [draft, setDraft] = useState<ActorLoadout>(initial ?? { body: 1, costume: [1, 1] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: ActorLoadout | null) {
    setBusy(true)
    setError(null)
    try {
      // Saving a look must also unequip the politician's whole-figure SKIN — a
      // skin wins over layers, so leaving it on would silently hide the custom
      // look in games (skins is replaced whole, hence the rebuild without it).
      const skins: Record<string, string> = {}
      for (const a of Object.keys(SKIN_CATALOG)) {
        if (a === 'politician') continue
        const cur = skinFor(wardrobe, a)
        if (cur) skins[a] = cur
      }
      await gameSocket.updateProfile({ wardrobe: { politician: next, skins: skins as Skins } })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.saveLoadoutFailed'))
    } finally {
      setBusy(false)
    }
  }

  function setAccessory(group: number, variant: number | null) {
    setDraft((d) => {
      const rest = (d.accessories ?? []).filter(([g]) => g !== group)
      return {
        ...d,
        accessories: variant === null ? rest : [...rest, [group, variant] as [number, number]]
      }
    })
  }

  const accessoryOf = (group: number): number | null =>
    (draft.accessories ?? []).find(([g]) => g === group)?.[1] ?? null

  return (
    <div className="wardrobe-editor">
      <div className="wardrobe-preview">
        <ActorArt type="politician" wardrobe={{ politician: draft }} />
      </div>
      <div className="wardrobe-controls">
        <div className="wardrobe-row">
          <span className="hud-label">{t('profile.body')}</span>
          <Chips
            options={numbered(POLITICIAN_PACK.bodies)}
            chosen={draft.body}
            onPick={(id) => id !== null && setDraft((d) => ({ ...d, body: id }))}
          />
        </div>
        <div className="wardrobe-row">
          <span className="hud-label">{t('profile.outfit')}</span>
          <Chips
            options={oneTo(POLITICIAN_PACK.costumes.groups).map((i) => {
              const key = COSTUME_KEYS[i - 1]
              return { id: i, name: key ? t(key) : String(i) }
            })}
            chosen={draft.costume[0]}
            onPick={(id) => id !== null && setDraft((d) => ({ ...d, costume: [id, 1] }))}
          />
          <span className="hud-label">{t('profile.colorway')}</span>
          <Chips
            options={numbered(POLITICIAN_PACK.costumes.variants)}
            chosen={draft.costume[1]}
            onPick={(id) => id !== null && setDraft((d) => ({ ...d, costume: [d.costume[0], id] }))}
          />
        </div>
        <div className="wardrobe-row">
          <span className="hud-label">{t('profile.hair')}</span>
          <Chips
            options={withNone(POLITICIAN_PACK.hair.groups, t('profile.none'))}
            chosen={draft.hair?.[0] ?? null}
            onPick={(id) =>
              setDraft((d) =>
                id === null ? { ...d, hair: null } : { ...d, hair: [id, d.hair?.[1] ?? 1] }
              )
            }
          />
          {draft.hair && (
            <>
              <span className="hud-label">{t('profile.color')}</span>
              <Chips
                options={numbered(POLITICIAN_PACK.hair.variants)}
                chosen={draft.hair[1]}
                onPick={(id) =>
                  id !== null && setDraft((d) => (d.hair ? { ...d, hair: [d.hair[0], id] } : d))
                }
              />
            </>
          )}
        </div>
        {oneTo(POLITICIAN_PACK.accessories.groups).map((group) => {
          const key = ACCESSORY_KEYS[group - 1]
          return (
            <div key={group} className="wardrobe-row">
              <span className="hud-label">
                {key ? t(key) : t('profile.accessoryN', { n: group })}
              </span>
              <Chips
                options={withNone(POLITICIAN_PACK.accessories.variants, t('profile.none'))}
                chosen={accessoryOf(group)}
                onPick={(variant) => setAccessory(group, variant)}
              />
            </div>
          )
        })}
        <div className="wardrobe-actions">
          <button className="btn confirm" disabled={busy || !online} onClick={() => save(draft)}>
            ✓ {t('profile.saveLook')}
          </button>
          <button className="btn reject" disabled={busy} onClick={onClose}>
            ✕ {t('common.cancel')}
          </button>
          <button className="btn" disabled={busy || !online} onClick={() => save(null)}>
            {t('profile.resetDefault')}
          </button>
        </div>
        {!online && <p className="hint-text">{t('profile.connectToSave')}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  )
}

function SkinThumb({
  art,
  label,
  selected,
  onClick,
  disabled
}: {
  art: ReactNode
  label: string
  selected: boolean
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      className={`skin-thumb ${selected ? 'chosen' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {art}
      <span>{label}</span>
    </button>
  )
}

/** The whole `skins` object with one actor changed. The server replaces `skins`
    wholesale, so a partial patch would silently drop the other actors. Shared
    between the skin gallery and the inventory's one-tap Use. */
export function skinsWith(wardrobe: Wardrobe | null, actor: string, id: string | null): Skins {
  const next: Record<string, string> = {}
  for (const a of Object.keys(SKIN_CATALOG)) {
    const cur = skinFor(wardrobe, a)
    if (cur) next[a] = cur
  }
  if (id) next[actor] = id
  else delete next[actor]
  return next as Skins
}

export function ActorSkinsSection({ ownedItems }: { ownedItems: ReadonlySet<string> }) {
  const t = useT()
  const d = useDomain()
  const navigate = useNavigate()
  const profile = useSessionStore((s) => s.profile)
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [fitting, setFitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const wardrobe = profile?.wardrobe ?? null
  const politicianLoadout = loadoutFor(wardrobe, 'politician')

  async function apply(patch: Wardrobe) {
    if (busy || !online) return
    setBusy(true)
    try {
      await gameSocket.updateProfile({ wardrobe: patch })
    } finally {
      setBusy(false)
    }
  }

  const pickSkin = (actor: string, id: string) => apply({ skins: skinsWith(wardrobe, actor, id) })

  /** "Default" means the canonical art, so it has to drop the layered look too —
      a loadout outranks the canon, and a tile that claimed otherwise would lie
      (this is the same reset the fitting room's "Restore default" performs). */
  const wearCanonical = (actor: string) =>
    apply({
      skins: skinsWith(wardrobe, actor, null),
      ...(actor === 'politician' ? { politician: null } : {})
    })

  return (
    <>
      <p className="hint-text">{t('profile.skinsBlurb')}</p>
      {ACTOR_TYPES.map((actor: ActorType) => {
        const chosen = skinFor(wardrobe, actor)
        // A saved loadout that no skin is covering: this is what the table sees.
        const customOn = actor === 'politician' && !chosen && !!politicianLoadout
        return (
          <div key={actor} className="skin-block">
            <div className="skin-head">
              <img src={themeAsset(`actor.${actor}.head`)} alt="" />
              <span className="skin-actor">{d.actor(actor)}</span>
              {actor === 'politician' && (
                <button className="btn" disabled={!online} onClick={() => setFitting((v) => !v)}>
                  {fitting ? t('common.close') : t('profile.customize')}
                </button>
              )}
            </div>
            <div className="skin-gallery">
              <SkinThumb
                art={<img src={themeAsset(`actor.${actor}`)} alt="" draggable={false} />}
                label={t('profile.default')}
                selected={!chosen && !customOn}
                disabled={busy || !online}
                onClick={() => void wearCanonical(actor)}
              />
              {/* The built look gets its own tile showing the actual composite —
                  without it a saved loadout left every tile unlit and read as
                  "the customiser did nothing". */}
              {politicianLoadout && actor === 'politician' && (
                <SkinThumb
                  art={<ActorArt type="politician" wardrobe={{ politician: politicianLoadout }} />}
                  label={t('profile.custom')}
                  selected={customOn}
                  disabled={busy || !online}
                  onClick={() => void apply({ skins: skinsWith(wardrobe, actor, null) })}
                />
              )}
              {(SKIN_CATALOG[actor] ?? [])
                // A personal skin belongs to one account: everyone else does not
                // see it at all. It is a gift, not a locked tile teasing a Shop
                // page that will never sell it.
                .filter(
                  (id) => !isExclusiveSkin(actor, id) || ownedItems.has(skinItemId(actor, id))
                )
                .map((id) => {
                  const key = SKIN_NAME_KEYS[id]
                  const label = key ? t(key) : id
                  // Unowned skins walk to the Shop instead of equipping.
                  if (!ownedItems.has(skinItemId(actor, id)))
                    return (
                      <button
                        key={id}
                        type="button"
                        className="skin-thumb locked"
                        title={t('profile.buyInShop')}
                        onClick={() => navigate('/shop')}
                      >
                        <img
                          src={themeAsset(`skin.${actor}.${id}`)}
                          alt={label}
                          draggable={false}
                        />
                        <span className="cosmetic-lock">🔒</span>
                        <span>{label}</span>
                      </button>
                    )
                  return (
                    <SkinThumb
                      key={id}
                      art={
                        <img
                          src={themeAsset(`skin.${actor}.${id}`)}
                          alt={label}
                          draggable={false}
                        />
                      }
                      label={label}
                      selected={chosen === id}
                      disabled={busy || !online}
                      onClick={() => void pickSkin(actor, id)}
                    />
                  )
                })}
            </div>
            {actor === 'politician' && fitting && (
              <PoliticianFitting
                key={JSON.stringify(politicianLoadout)}
                initial={politicianLoadout}
                wardrobe={wardrobe}
                onClose={() => setFitting(false)}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Argument coins: the free classic set plus every bought alloy. One choice for
 * all four coins — a mixed set would let a rival read the argument off the
 * metal instead of the engraving.
 */
function ArgumentCoinsSection({ ownedItems }: { ownedItems: ReadonlySet<string> }) {
  const t = useT()
  const navigate = useNavigate()
  const profile = useSessionStore((s) => s.profile)
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [busy, setBusy] = useState(false)
  const chosen = argSkinFor(profile?.wardrobe)

  async function pick(id: ArgSkinId | null) {
    if (busy || !online || id === chosen) return
    setBusy(true)
    try {
      await gameSocket.updateProfile({ wardrobe: { arguments: id } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="hint-text">{t('profile.argumentsBlurb')}</p>
      <div className="skin-gallery">
        <button
          type="button"
          className={`skin-thumb ${chosen === null ? 'chosen' : ''}`}
          disabled={busy || !online}
          onClick={() => void pick(null)}
          title={t('shop.argSet.default')}
        >
          <CoinSet set={null} />
          <span>{t('shop.argSet.default')}</span>
        </button>
        {ARG_SKIN_IDS.map((id) => {
          const label = t(ARG_SET_NAME_KEYS[id] ?? id)
          // Unowned sets walk to the Shop instead of equipping.
          if (!ownedItems.has(argSkinItemId(id)))
            return (
              <button
                key={id}
                type="button"
                className="skin-thumb locked"
                title={t('profile.buyInShop')}
                onClick={() => navigate('/shop')}
              >
                <CoinSet set={id} />
                <span className="cosmetic-lock">🔒</span>
                <span>{label}</span>
              </button>
            )
          return (
            <button
              key={id}
              type="button"
              className={`skin-thumb ${chosen === id ? 'chosen' : ''}`}
              disabled={busy || !online}
              onClick={() => void pick(id)}
              title={label}
            >
              <CoinSet set={id} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/**
 * Everything this account owns, and the two things it can do with a piece of it:
 * wear it, or put it on the Market. Grouped by the same categories the Market
 * filters on, so "where is my stuff" and "where do I sell it" read alike.
 *
 * Items already on the shelf are shown as listed rather than hidden — a player
 * looking for a skin they cannot find must be told it is up for sale, not left
 * to think it vanished.
 */
function InventoryPanel({ ownedItems }: { ownedItems: ReadonlySet<string> }) {
  const t = useT()
  const d = useDomain()
  const navigate = useNavigate()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const profile = useSessionStore((s) => s.profile)
  const [listedIds, setListedIds] = useState<Set<string> | null>(null)
  const [selling, setSelling] = useState<string | null>(null)
  const [price, setPrice] = useState('100')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshListed = useCallback(async () => {
    const page = await gameSocket.marketBrowse({ mine: true })
    setListedIds(new Set(page.rows.map((r) => r.itemId)))
  }, [])

  useEffect(() => {
    if (!online) return
    let cancelled = false
    gameSocket
      .marketBrowse({ mine: true })
      .then((page) => !cancelled && setListedIds(new Set(page.rows.map((r) => r.itemId))))
      .catch(() => !cancelled && setListedIds(new Set()))
    return () => {
      cancelled = true
    }
  }, [online])

  async function list(itemId: string) {
    const asking = Number(price)
    if (!Number.isInteger(asking) || asking < 1) return
    setBusy(true)
    setError(null)
    try {
      await gameSocket.marketList(itemId, asking)
      setSelling(null)
      await refreshListed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Is this the piece the account is currently wearing? Derived live from the
   * wardrobe in the session profile (socket's `profile.updated` re-renders it),
   * so the badge moves the moment the look changes anywhere.
   */
  function equipped(itemId: string): boolean {
    const wardrobe = profile?.wardrobe ?? null
    if (itemId.startsWith('skin.')) {
      const [, actor, skin] = itemId.split('.')
      return !!actor && !!skin && skinFor(wardrobe, actor) === skin
    }
    if (itemId.startsWith('argSkin.')) {
      const id = itemId.slice('argSkin.'.length)
      return argSkinFor(wardrobe) === id
    }
    if (itemId.startsWith('avatar.')) {
      const id = itemId.slice('avatar.'.length)
      return profile?.avatar === id
    }
    return false
  }

  /**
   * "Use" means exactly that: equip the piece the tap named, THEN open the
   * Appearance tab so the player sees it on. Anything else would force them to
   * repeat the choice they just made. Actor items and avatars have no skin to
   * equip, so the tap only walks to the tab where they are picked.
   */
  async function use(itemId: string) {
    setBusy(true)
    setError(null)
    try {
      const wardrobe = profile?.wardrobe ?? null
      if (itemId.startsWith('skin.')) {
        const [, actor, skin] = itemId.split('.')
        if (actor && skin)
          await gameSocket.updateProfile({ wardrobe: { skins: skinsWith(wardrobe, actor, skin) } })
      } else if (itemId.startsWith('argSkin.')) {
        const id = itemId.slice('argSkin.'.length)
        await gameSocket.updateProfile({ wardrobe: { arguments: id as ArgSkinId } })
      }
      navigate('/profile/looks')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Personal gifts sit in the inventory like anything else, but isTradable says
  // no: they belong to one account and are not goods (protocol shop.ts).
  const owned = [...ownedItems]
  const groups = MARKET_CATEGORIES.map((category) => ({
    category,
    items: owned.filter((id) => categoryOfItem(id) === category)
  })).filter((g) => g.items.length > 0)

  return (
    <>
      <p className="hint-text">{t('profile.inventoryBlurb')}</p>
      {owned.length === 0 && <p className="hint-text">{t('profile.inventoryEmpty')}</p>}
      {groups.map((group) => (
        <div key={group.category} className="inventory-group">
          <p className="hud-label">{t(CATEGORY_LABEL_KEYS[group.category])}</p>
          <div className="inventory-grid">
            {group.items.map((itemId) => {
              const listed = listedIds?.has(itemId) ?? false
              const inUse = equipped(itemId)
              return (
                <div
                  key={itemId}
                  className={`inv-item ${listed ? 'listed' : ''} ${inUse ? 'in-use' : ''}`}
                >
                  <div className="inv-art">
                    <ItemArt itemId={itemId} />
                  </div>
                  <span className="inv-name">{itemName(itemId, t, d)}</span>
                  {inUse && !listed && <span className="inv-badge">✓ {t('profile.inUse')}</span>}
                  {listed ? (
                    <button className="btn secondary" onClick={() => navigate('/market')}>
                      {t('profile.onTheMarket')}
                    </button>
                  ) : selling === itemId ? (
                    <div className="row">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={price}
                        onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
                        aria-label={t('profile.askingPrice')}
                      />
                      <button
                        className="btn confirm"
                        style={{ flex: 'none', width: 'auto' }}
                        disabled={busy || !online}
                        onClick={() => void list(itemId)}
                      >
                        ✓
                      </button>
                      <button
                        className="btn reject"
                        style={{ flex: 'none', width: 'auto' }}
                        onClick={() => setSelling(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        className="btn secondary"
                        disabled={busy || !online || inUse}
                        onClick={() => void use(itemId)}
                        title={t('profile.wearIt')}
                      >
                        {t('profile.wearIt')}
                      </button>
                      {isTradable(itemId) && (
                        <button
                          className="btn secondary"
                          disabled={!online}
                          onClick={() => setSelling(itemId)}
                        >
                          {t('profile.sellIt')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {error && <p className="error-text">{error}</p>}
    </>
  )
}

/** The tab is the URL, so a link to the inventory opens the inventory. */
const PROFILE_TABS = ['stats', 'inventory', 'looks', 'account'] as const
type ProfileTab = (typeof PROFILE_TABS)[number]

export function ProfileScreen() {
  const email = useSessionStore((s) => s.email)
  const navigate = useNavigate()
  const params = useParams<{ tab?: string }>()
  const tab: ProfileTab = (PROFILE_TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as ProfileTab)
    : 'stats'
  const t = useT()
  const profile = useSessionStore((s) => s.profile)
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [draft, setDraft] = useState(profile?.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [record, setRecord] = useState<ModeRecord | null>(null)
  const [achievements, setAchievements] = useState<AchievementState | null>(null)
  const { wallet } = useWallet()
  const ownedItems = new Set(wallet?.owned ?? [])

  // The profile often lands after this screen mounts (welcome is async) — fill
  // the field once it does; an untouched empty draft is never a real value.
  useEffect(() => {
    setDraft((current) => (current === '' && profile ? profile.nickname : current))
  }, [profile])

  useEffect(() => {
    if (!online || history !== null) return
    let cancelled = false
    gameSocket
      .fetchHistory()
      .then((msg) => {
        if (cancelled) return
        setHistory(msg.p.entries)
        setRecord(msg.p.record)
        setAchievements(msg.p.achievements ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setHistory([])
        setRecord(emptyModeRecord())
      })
    return () => {
      cancelled = true
    }
  }, [online, history])

  /** Recent games can be starred like PAST GAMES: optimistic flip, server
      reconciles, revert on error. The replay viewer reads the same flag. */
  function toggleHistoryStar(entry: HistoryEntry): void {
    const starred = !entry.starred
    setHistory((prev) =>
      prev ? prev.map((g) => (g.gameId === entry.gameId ? { ...g, starred } : g)) : prev
    )
    gameSocket.replayStar(entry.gameId, starred).catch(() => {
      setHistory((prev) =>
        prev
          ? prev.map((g) => (g.gameId === entry.gameId ? { ...g, starred: entry.starred } : g))
          : prev
      )
    })
  }

  const trimmed = draft.trim()
  const unchanged = trimmed === profile?.nickname
  const check = validateNickname(draft)
  // Local and remote refusals share one vocabulary (NicknameIssue), so the player
  // reads the same translated sentence either way — the wire carries only the
  // English message, and nicknameIssueOf maps it back to a key.
  const nickVars = { min: NICKNAME_MIN, max: NICKNAME_MAX }
  const localIssue = trimmed.length > 0 && !check.ok ? check.issue : null
  const serverIssue = error ? nicknameIssueOf(error) : null
  const shownError = serverIssue
    ? t(`profile.nickname.${serverIssue}`, nickVars)
    : (error ?? (localIssue ? t(`profile.nickname.${localIssue}`, nickVars) : null))

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await gameSocket.updateProfile({ nickname: trimmed })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function pickAvatar(avatar: AvatarId | null) {
    if (busy || avatar === (profile?.avatar ?? null)) return
    setBusy(true)
    setError(null)
    try {
      await gameSocket.updateProfile({ avatar })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen profile-screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      {/* Four tabs instead of one eight-panel scroll: what you ARE (stats),
          what you HAVE (inventory), how you LOOK, and the account itself. */}
      <nav className="profile-tabs">
        {PROFILE_TABS.map((id) => (
          <button
            key={id}
            className={`chip-toggle ${tab === id ? 'active' : ''}`}
            onClick={() => navigate(id === 'stats' ? '/profile' : `/profile/${id}`)}
          >
            {t(`profile.tab.${id}`)}
          </button>
        ))}
      </nav>

      {tab === 'stats' && (
        <div className="profile-grid tab-stats">
          <div className="panel">
            <h2>{t('profile.record')}</h2>
            <RecordPanel record={record} />
          </div>

          <div className="panel">
            <h2>{t('achv.title')}</h2>
            <AchievementsPanel state={achievements} />
          </div>

          <div className="panel">
            <h2>{t('profile.recentGames')}</h2>
            {history === null && <p className="hint-text">{t('common.loading')}</p>}
            {history?.length === 0 && <p className="hint-text">{t('profile.noGames')}</p>}
            {history && history.length > 0 && (
              <ul className="history-list">
                {history.map((entry) => (
                  <HistoryRow key={entry.gameId} entry={entry} onToggleStar={toggleHistoryStar} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="profile-grid tab-inventory">
          <div className="panel">
            <h2>{t('profile.tab.inventory')}</h2>
            <div className="gato-balance-row">
              <img className="gato-coin" src={themeAsset('currency.gato')} alt="" />
              <span className="gato-amount">
                {wallet ? t('profile.gatoBalance', { n: wallet.balance }) : '…'}
              </span>
              <button className="btn secondary" onClick={() => navigate('/market')}>
                {t('profile.toMarket')}
              </button>
            </div>
            <InventoryPanel ownedItems={ownedItems} />
          </div>
        </div>
      )}

      {tab === 'looks' && (
        <div className="profile-grid tab-looks">
          <div className="panel">
            <h2>{t('profile.actorSkins')}</h2>
            <ActorSkinsSection ownedItems={ownedItems} />
          </div>

          <div className="panel">
            <h2>{t('profile.argumentCoins')}</h2>
            <ArgumentCoinsSection ownedItems={ownedItems} />
          </div>
        </div>
      )}

      {tab === 'account' && (
        <div className="profile-grid tab-account">
          <div className="panel">
            <h2>{t('profile.title')}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <div className="field">
                <label htmlFor="nickname">{t('profile.nickname')}</label>
                <input
                  id="nickname"
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setSaved(false)
                    setError(null)
                  }}
                  maxLength={NICKNAME_MAX}
                  autoComplete="off"
                />
              </div>
              <p className="hint-text">{t('profile.nicknameRule', nickVars)}</p>
              <button
                className="btn"
                type="submit"
                disabled={!online || busy || unchanged || !check.ok}
              >
                {t('common.save')}
              </button>
            </form>
            <p className="error-text">{shownError}</p>
            {saved && <p className="hint-text">{t('profile.saved')}</p>}
            {!online && <p className="hint-text">{t('profile.reconnectRename')}</p>}

            <div className="field" style={{ marginTop: 6 }}>
              <label>{t('profile.avatar')}</label>
              <div className="avatar-grid">
                <button
                  type="button"
                  className={`avatar-option ${!profile?.avatar ? 'chosen' : ''}`}
                  disabled={!online || busy}
                  onClick={() => void pickAvatar(null)}
                  aria-label={t('profile.noAvatar')}
                >
                  <span className="avatar-none">∅</span>
                  <span className="avatar-name">{t('profile.none')}</span>
                </button>
                {AVATAR_IDS.map((id) => {
                  // Paid faces stay locked until bought — the tile walks to the Shop.
                  const locked = !isFreeAvatar(id) && !ownedItems.has(avatarItemId(id))
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`avatar-option ${profile?.avatar === id ? 'chosen' : ''} ${locked ? 'locked' : ''}`}
                      disabled={!online || (busy && !locked)}
                      title={locked ? t('profile.buyInShop') : undefined}
                      onClick={() => (locked ? navigate('/shop') : void pickAvatar(id))}
                      aria-label={t('profile.avatarLabel', { id })}
                    >
                      <img src={themeAsset(`avatar.${id}`)} alt="" />
                      {locked && <span className="cosmetic-lock">🔒</span>}
                      <span className="avatar-name">{id}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>{t('profile.security')}</h2>
            {email ? <PasswordSection /> : <AddEmailLogin />}
            <TotpSection />
          </div>

          <div className="panel">
            <h2>{t('profile.wallet')}</h2>
            <WalletSection wallet={wallet} />
          </div>
        </div>
      )}

      <div className="row" style={{ maxWidth: 440, width: '100%' }}>
        <button className="btn secondary" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
        <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>
          {t('common.logout')}
        </button>
      </div>
    </div>
  )
}
