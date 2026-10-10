// Nickname rules, shared so the client can give instant feedback and the server
// can enforce the same thing authoritatively. The DB check is `char_length
// between 3 and 20`; everything stricter lives here.

export const NICKNAME_MIN = 3
export const NICKNAME_MAX = 20

/**
 * One word — no spaces — out of Latin letters (either case), digits, `-`, `_`
 * and round/square/angle brackets. Nothing else, by the author's rule.
 *
 * ASCII only: a Cyrillic «а» next to a Latin «a» is an impersonation vector, not
 * a feature. The punctuation may sit anywhere, so clan-tag shapes like
 * `[MTA]Asa`, `Asa_(MTA)` and `<Okeesha>` all work.
 */
export const NICKNAME_CHARSET = /^[A-Za-z0-9_\-()[\]<>]+$/

/** …but a name made only of punctuation (`<<>>`, `___`) is not a name: a player
 *  has to be able to say it out loud, and the leaderboard has to show it. */
const HAS_ALPHANUMERIC = /[A-Za-z0-9]/

/** Exact matches only — «robot» must stay legal while «bot» does not. */
const RESERVED = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'metarchy',
  'official',
  'staff',
  'support',
  'system',
  'server',
  'bot',
  'root',
  'null',
  'undefined',
  'anonymous'
])

/**
 * Substring matches on the normalized form. A blocklist is a blunt instrument
 * (it will refuse the occasional innocent name) — deliberate: an MVP filter that
 * over-refuses is cheaper than one that lets slurs onto a leaderboard.
 */
const BANNED = [
  'nigger',
  'nigga',
  'faggot',
  'cunt',
  'fuck',
  'shit',
  'rape',
  'hitler',
  'nazi',
  'kike',
  'tranny'
]

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's'
}

/** Collapses the tricks people use to smuggle a banned word past a blocklist. */
function normalize(nickname: string): string {
  return nickname
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .toLowerCase()
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Why a code and not just a sentence: the client shows the player a *translated*
 * refusal, and the only thing that survives the wire is the error `message`
 * (see ErrorMessageSchema — the socket forwards `p.message` and drops the rest).
 * Both sides therefore agree on this small vocabulary; the strings below are the
 * log/wire form and the English fallback.
 *
 * `taken` never comes out of validateNickname() — uniqueness is the store's
 * answer — but it lives here so the client has one place to map refusals from.
 */
export type NicknameIssue = 'length' | 'charset' | 'reserved' | 'banned' | 'taken'

export const NICKNAME_ISSUE_MESSAGE: Record<NicknameIssue, string> = {
  length: `Use between ${NICKNAME_MIN} and ${NICKNAME_MAX} characters.`,
  charset: 'One word only: letters, digits, - _ ( ) [ ] < >.',
  reserved: 'That name is reserved.',
  banned: 'Pick a different name.',
  taken: 'That nickname is taken.'
}

/** Reverse of the map above, for a refusal that arrived as a bare string. */
export function nicknameIssueOf(message: string): NicknameIssue | null {
  const hit = Object.entries(NICKNAME_ISSUE_MESSAGE).find(([, text]) => text === message)
  return hit ? (hit[0] as NicknameIssue) : null
}

export type NicknameCheck =
  { ok: true; value: string } | { ok: false; issue: NicknameIssue; reason: string }

const fail = (issue: NicknameIssue): NicknameCheck => ({
  ok: false,
  issue,
  reason: NICKNAME_ISSUE_MESSAGE[issue]
})

/** Trims, then validates. `value` is what should be persisted. */
export function validateNickname(raw: string): NicknameCheck {
  const value = raw.trim()
  if (value.length < NICKNAME_MIN || value.length > NICKNAME_MAX) return fail('length')
  if (!NICKNAME_CHARSET.test(value) || !HAS_ALPHANUMERIC.test(value)) return fail('charset')

  const normalized = normalize(value)
  if (RESERVED.has(normalized)) return fail('reserved')
  if (BANNED.some((word) => normalized.includes(word))) return fail('banned')

  return { ok: true, value }
}
