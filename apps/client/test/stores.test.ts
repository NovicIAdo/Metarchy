import { describe, expect, it } from 'vitest'
import { useGameStore } from '../src/stores/game.js'
import { useSessionStore } from '../src/stores/session.js'

describe('game store', () => {
  it('keeps lastEventSeq monotonic across sync and events', () => {
    const s = useGameStore.getState()
    s.bumpEventSeq(5)
    s.setView({ seq: 3 } as never, 3)
    expect(useGameStore.getState().lastEventSeq).toBe(5)
    s.bumpEventSeq(9)
    expect(useGameStore.getState().lastEventSeq).toBe(9)
  })

  it('resetGame clears everything game-scoped', () => {
    const s = useGameStore.getState()
    s.setActiveGame({ gameId: 'g', mode: '1v1', seat: 0, status: 'active' })
    s.setInviteCode('ABC123')
    s.setDeadline({ phaseRef: 'x', endsAt: 1 })
    s.resetGame()
    const after = useGameStore.getState()
    expect(after.activeGame).toBeNull()
    expect(after.inviteCode).toBeNull()
    expect(after.deadline).toBeNull()
    expect(after.lastEventSeq).toBe(0)
  })
})

describe('session store', () => {
  it('marks auth ready once the first auth state lands', () => {
    expect(useSessionStore.getState().authReady).toBe(false)
    useSessionStore.getState().setAuth(null, null)
    expect(useSessionStore.getState().authReady).toBe(true)
    useSessionStore.getState().setAuth('u1', 'a@b.c')
    expect(useSessionStore.getState().userId).toBe('u1')
  })
})
