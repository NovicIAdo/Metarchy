import { describe, expect, it } from 'vitest'
import {
  ClientIntentSchema,
  emptyModeRecord,
  encodeServerMessage,
  INVITE_CODE_RE,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  ServerMessageSchema,
  winRate
} from '../src/index.js'
import type { ServerMessage } from '../src/index.js'

const GAME_ID = '0192e4a0-0000-7000-8000-000000000001'

describe('client messages', () => {
  it('parses a minimal hello', () => {
    const r = parseClientMessage(JSON.stringify({ t: 'hello', p: { accessToken: 'jwt' } }))
    expect(r.ok).toBe(true)
    if (r.ok && r.msg.t === 'hello') expect(r.msg.p.accessToken).toBe('jwt')
  })

  it('parses hello with resume', () => {
    const r = parseClientMessage({
      t: 'hello',
      seq: 1,
      p: { accessToken: 'jwt', resume: { gameId: GAME_ID, lastEventSeq: 42 } }
    })
    expect(r.ok).toBe(true)
  })

  it('rejects invalid JSON, unknown t, and non-objects', () => {
    expect(parseClientMessage('{oops').ok).toBe(false)
    expect(parseClientMessage({ t: 'nope' }).ok).toBe(false)
    expect(parseClientMessage(42).ok).toBe(false)
  })

  it('rejects unknown envelope keys and unknown payload keys', () => {
    expect(parseClientMessage({ t: 'ping', x: 1 }).ok).toBe(false)
    expect(parseClientMessage({ t: 'hello', p: { accessToken: 'jwt', admin: true } }).ok).toBe(
      false
    )
  })

  it('accepts a full intent envelope', () => {
    const r = parseClientMessage({
      t: 'intent',
      seq: 7,
      p: {
        gameId: GAME_ID,
        intent: {
          type: 'distribution.commit',
          placements: [
            { actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'win' },
            { actorType: 'scientist', locationId: 'university', argument: 'paper' },
            { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
            { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
          ]
        }
      }
    })
    expect(r.ok).toBe(true)
  })

  it('never accepts server-injected system intents from the wire', () => {
    for (const intent of [
      { type: 'system.timeout', seat: 0 },
      { type: 'system.eliminate', seat: 1, reason: 'disconnect' }
    ]) {
      expect(ClientIntentSchema.safeParse(intent).success).toBe(false)
      expect(parseClientMessage({ t: 'intent', p: { gameId: GAME_ID, intent } }).ok).toBe(false)
    }
  })

  it('validates intent fields', () => {
    expect(ClientIntentSchema.safeParse({ type: 'event.discard', amount: -1 }).success).toBe(false)
    expect(ClientIntentSchema.safeParse({ type: 'event.discard', amount: 2.5 }).success).toBe(false)
    expect(ClientIntentSchema.safeParse({ type: 'event.discard', amount: 3 }).success).toBe(true)
    expect(ClientIntentSchema.safeParse({ type: 'tiebreak.rps', choice: 'dummy' }).success).toBe(
      false
    )
    expect(
      ClientIntentSchema.safeParse({ type: 'action.relocate', actorId: '4:robot', to: 'dump' })
        .success
    ).toBe(false)
    expect(
      ClientIntentSchema.safeParse({ type: 'action.relocate', actorId: '2:robot', to: 'dump' })
        .success
    ).toBe(true)
  })

  it('bounds chat text and invite codes', () => {
    expect(
      parseClientMessage({ t: 'chat.team', p: { gameId: GAME_ID, text: 'x'.repeat(280) } }).ok
    ).toBe(true)
    expect(
      parseClientMessage({ t: 'chat.team', p: { gameId: GAME_ID, text: 'x'.repeat(281) } }).ok
    ).toBe(false)
    expect(parseClientMessage({ t: 'game.join', p: { inviteCode: 'abc123' } }).ok).toBe(true)
    expect(parseClientMessage({ t: 'game.join', p: { inviteCode: 'abc12' } }).ok).toBe(false)
    expect(INVITE_CODE_RE.test('A1B2C3')).toBe(true)
  })
})

describe('server messages', () => {
  it('round-trips a visibility-filtered game event', () => {
    const msg: ServerMessage = {
      t: 'game.event',
      p: {
        gameId: GAME_ID,
        seq: 12,
        event: { seq: 12, type: 'p2.committed', payload: { seat: 0 }, visibility: [0] }
      }
    }
    const parsed = ServerMessageSchema.safeParse(JSON.parse(encodeServerMessage(msg)))
    expect(parsed.success).toBe(true)
  })

  it('validates error codes', () => {
    expect(
      ServerMessageSchema.safeParse({ t: 'error', p: { code: 'rule_violation', message: 'no' } })
        .success
    ).toBe(true)
    expect(
      ServerMessageSchema.safeParse({ t: 'error', p: { code: 'wat', message: 'no' } }).success
    ).toBe(false)
  })

  it('exports a sane frame size limit', () => {
    expect(MAX_MESSAGE_BYTES).toBeGreaterThanOrEqual(16 * 1024)
  })
})

describe('team.staging (2v2 live drafts)', () => {
  it('parses p2, discard and clear payloads both directions', () => {
    const p2 = parseClientMessage({
      t: 'team.staging',
      p: {
        gameId: GAME_ID,
        staging: {
          kind: 'p2',
          turn: 3,
          placements: [
            { actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'win' },
            { actorType: 'robot', locationId: 'dump', argument: 'dummy' }
          ]
        }
      }
    })
    expect(p2.ok).toBe(true)
    expect(
      parseClientMessage({
        t: 'team.staging',
        p: { gameId: GAME_ID, staging: { kind: 'discard', turn: 2, amount: 3 } }
      }).ok
    ).toBe(true)
    expect(
      parseClientMessage({
        t: 'team.staging',
        p: { gameId: GAME_ID, staging: { kind: 'clear', turn: 2 } }
      }).ok
    ).toBe(true)

    const relay: ServerMessage = {
      t: 'team.staging',
      p: { gameId: GAME_ID, fromSeat: 2, staging: { kind: 'discard', turn: 2, amount: 3 } }
    }
    const parsed = ServerMessageSchema.safeParse(JSON.parse(encodeServerMessage(relay)))
    expect(parsed.success).toBe(true)
  })

  it('rejects oversized or malformed staging payloads', () => {
    const five = Array.from({ length: 5 }, () => ({
      actorType: 'politician',
      locationId: 'square',
      argument: 'rock'
    }))
    expect(
      parseClientMessage({
        t: 'team.staging',
        p: { gameId: GAME_ID, staging: { kind: 'p2', turn: 1, placements: five } }
      }).ok
    ).toBe(false)
    expect(
      parseClientMessage({
        t: 'team.staging',
        p: { gameId: GAME_ID, staging: { kind: 'discard', turn: 1, amount: -1 } }
      }).ok
    ).toBe(false)
    expect(
      parseClientMessage({
        t: 'team.staging',
        p: { gameId: GAME_ID, staging: { kind: 'p2', turn: 1, placements: [], extra: true } }
      }).ok
    ).toBe(false)
  })
})

describe('profile record', () => {
  it('has no win rate at all with no games — 0/0 never divides', () => {
    const record = emptyModeRecord()
    expect(winRate(record.ranked)).toBeNull()
    expect(winRate(record.bots)).toBeNull()
    expect(winRate({ played: 3, wins: 1, losses: 2 })).toBe(33)
    expect(winRate({ played: 2, wins: 2, losses: 0 })).toBe(100)
  })

  it('rides the history reply, which is refused without it', () => {
    const reply: ServerMessage = { t: 'history', p: { entries: [], record: emptyModeRecord() } }
    expect(ServerMessageSchema.safeParse(JSON.parse(encodeServerMessage(reply))).success).toBe(true)
    expect(ServerMessageSchema.safeParse({ t: 'history', p: { entries: [] } }).success).toBe(false)
  })
})
