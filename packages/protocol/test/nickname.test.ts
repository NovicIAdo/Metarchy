import { describe, expect, it } from 'vitest'
import { nicknameIssueOf, NICKNAME_ISSUE_MESSAGE, validateNickname } from '../src/index.js'

/** Convenience: the reason string only matters to humans, `ok` is the contract. */
const accepts = (raw: string) => validateNickname(raw).ok
const rejects = (raw: string) => !validateNickname(raw).ok
const issue = (raw: string) => {
  const check = validateNickname(raw)
  return check.ok ? null : check.issue
}

describe('validateNickname', () => {
  it('accepts ordinary names and trims them', () => {
    expect(validateNickname('  Nikita_7 ')).toEqual({ ok: true, value: 'Nikita_7' })
    expect(accepts('abc')).toBe(true)
    expect(accepts('a'.repeat(20))).toBe(true)
    expect(accepts('metarchy-fan')).toBe(true)
    expect(accepts('080')).toBe(true)
  })

  it('accepts the bracket characters anywhere, so clan tags work', () => {
    expect(accepts('[MTA]Asa')).toBe(true)
    expect(accepts('<Okeesha>')).toBe(true)
    expect(accepts('Asa_(MTA)')).toBe(true)
    expect(accepts('-Okeesha-')).toBe(true)
    expect(accepts('_lead')).toBe(true)
  })

  it('enforces length after trimming', () => {
    expect(issue('ab')).toBe('length')
    expect(issue('  ab  ')).toBe('length')
    expect(issue('a'.repeat(21))).toBe('length')
  })

  it('refuses everything outside the allowed charset', () => {
    expect(issue('has space')).toBe('charset')
    expect(issue('two words')).toBe('charset')
    expect(issue('emoji😀name')).toBe('charset')
    // Cyrillic homoglyphs would let two players share one apparent name
    expect(issue('Океша')).toBe('charset')
    expect(rejects('dot.name')).toBe(true)
    expect(rejects('a@b')).toBe(true)
    expect(rejects('curly{braces}')).toBe(true)
    expect(rejects('slash/name')).toBe(true)
    expect(rejects("quote'name")).toBe(true)
    // Punctuation is decoration, not a name
    expect(issue('<<>>')).toBe('charset')
    expect(issue('___')).toBe('charset')
  })

  it('reserves operator names by exact match, brackets and all', () => {
    expect(issue('admin')).toBe('reserved')
    expect(issue('ADMIN')).toBe('reserved')
    expect(issue('<admin>')).toBe('reserved') // the wrapper is not a disguise
    expect(rejects('Metarchy')).toBe(true)
    expect(rejects('bot')).toBe(true)
    expect(accepts('robot')).toBe(true)
    expect(accepts('admin_fan')).toBe(true)
  })

  it('sees through leetspeak and separator padding in slurs', () => {
    expect(issue('n1gger')).toBe('banned')
    expect(rejects('f-u-c-k')).toBe(true)
    expect(rejects('f(u)c[k]')).toBe(true)
    expect(rejects('AdolfHitler')).toBe(true)
  })

  it('round-trips an issue through the wire form the server sends', () => {
    // The socket forwards only `p.message`; the client maps it back to translate.
    expect(nicknameIssueOf(NICKNAME_ISSUE_MESSAGE.taken)).toBe('taken')
    const check = validateNickname('has space')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(nicknameIssueOf(check.reason)).toBe('charset')
    expect(nicknameIssueOf('some unrelated server error')).toBeNull()
  })
})
