import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { runSync } from '../../public/js/sync.js'
import { initStorage } from '../../public/js/storage.js'
import { initPracticeTracker } from '../../public/js/practiceTracker.js'

const USER = 'user-1'

// Minimal fake of the Supabase client covering exactly the calls runSync makes:
// from('training_sessions').select('id') / .select('data').in('id',ids) / .upsert
// from('user_fingerings').select('*') / .upsert ; and auth.getUser().
function makeFakeSupabase({ sessions = [], fingerings = [] } = {}) {
  const sess = new Map(sessions.map((r) => [r.id, r]))
  const fing = new Map(fingerings.map((r) => [r.score_url, r]))
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from(table) {
      if (table === 'training_sessions') {
        return {
          select(cols) {
            const all = [...sess.values()]
            return {
              data: cols === 'id' ? all.map((r) => ({ id: r.id })) : all,
              error: null,
              in(_col, vals) {
                const set = new Set(vals)
                return { data: all.filter((r) => set.has(r.id)).map((r) => ({ data: r.data })), error: null }
              },
            }
          },
          upsert(rows) {
            for (const r of rows) sess.set(r.id, r)
            return { error: null }
          },
        }
      }
      return {
        select() {
          const all = [...fing.values()]
          return {
            data: all,
            error: null,
            in(_col, vals) {
              const set = new Set(vals)
              return { data: all.filter((r) => set.has(r.score_url)), error: null }
            },
          }
        },
        upsert(rows) {
          for (const r of rows) fing.set(r.score_url, r)
          return { error: null }
        },
      }
    },
    _sessions: sess,
    _fingerings: fing,
  }
}

function endedSession(id, scoreId) {
  return {
    id,
    scoreId,
    totalMeasures: 10,
    mode: 'training',
    startedAt: '2026-01-01T10:00:00.000Z',
    playthroughStartedAt: null,
    completedAt: null,
    endedAt: '2026-01-01T10:05:00.000Z',
    measures: [
      {
        sourceMeasureIndex: 0,
        attempts: [{ startedAt: '2026-01-01T10:00:10.000Z', durationMs: 3000, wrongNotes: 0, clean: true }],
      },
    ],
  }
}

describe('runSync', () => {
  let storage
  let practiceTracker

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    storage = initStorage()
    practiceTracker = initPracticeTracker(storage)
    await storage.init()
  })

  it('pushes local-only ended sessions to the server', async () => {
    await storage.saveSession(endedSession('a', '/s/1.xml'))
    await storage.saveSession(endedSession('b', '/s/2.xml'))
    const supabase = makeFakeSupabase()

    const r = await runSync({ supabase, storage, practiceTracker })

    expect(r.pushed).toBe(2)
    expect([...supabase._sessions.keys()].sort()).toEqual(['a', 'b'])
  })

  it('does not re-push sessions already on the server', async () => {
    await storage.saveSession(endedSession('a', '/s/1.xml'))
    const supabase = makeFakeSupabase({
      sessions: [{ user_id: USER, id: 'a', data: endedSession('a', '/s/1.xml'), ended_at: 'x' }],
    })

    const r = await runSync({ supabase, storage, practiceTracker })

    expect(r.pushed).toBe(0)
    expect(r.pulled).toBe(0)
  })

  it('skips in-progress sessions (no endedAt)', async () => {
    const s = endedSession('a', '/s/1.xml')
    s.endedAt = null
    await storage.saveSession(s)
    const supabase = makeFakeSupabase()

    const r = await runSync({ supabase, storage, practiceTracker })

    expect(r.pushed).toBe(0)
    expect(supabase._sessions.size).toBe(0)
  })

  it('pulls server-only sessions and rebuilds aggregates locally', async () => {
    const remote = endedSession('z', '/s/9.xml')
    const supabase = makeFakeSupabase({
      sessions: [{ user_id: USER, id: 'z', data: remote, ended_at: remote.endedAt }],
    })

    const r = await runSync({ supabase, storage, practiceTracker })

    expect(r.pulled).toBe(1)
    expect((await storage.getSession('z')).scoreId).toBe('/s/9.xml')
    const aggs = await storage.getAllAggregates()
    expect(aggs.length).toBe(1)
    expect(aggs[0].scoreId).toBe('/s/9.xml')
    expect(aggs[0].measures['0'].totalAttempts).toBe(1)
  })

  it('does not credit the session being played to the aggregates it rebuilds', async () => {
    practiceTracker.startSession('/s/live.xml', 'Live', 'Composer', 'free', 10)
    practiceTracker.startMeasureAttempt(0)
    await practiceTracker.endMeasureAttempt(true)
    // endMeasureAttempt persists in the background; make sure the in-progress
    // session is on disk before the sync replays what it finds there.
    await storage.saveSession(practiceTracker.getCurrentSession())

    // A pull is what triggers the rebuild.
    const remote = endedSession('z', '/s/9.xml')
    const supabase = makeFakeSupabase({
      sessions: [{ user_id: USER, id: 'z', data: remote, ended_at: remote.endedAt }],
    })
    await runSync({ supabase, storage, practiceTracker })

    await practiceTracker.endSession()

    const agg = await storage.getAggregate('/s/live.xml')
    expect(agg.totalSessions).toBe(1)
    expect(agg.measures['0'].totalAttempts).toBe(1)
  })

  it('fingerings: pushes local-newer, pulls remote-newer (last-write-wins)', async () => {
    await storage.putFingeringRecord({ scoreUrl: '/s/1.xml', fingerings: { n1: 1 }, updatedAt: 2000 })
    const supabase = makeFakeSupabase({
      fingerings: [
        { user_id: USER, score_url: '/s/1.xml', fingerings: { n1: 9 }, updated_at: 1000 }, // older → local wins
        { user_id: USER, score_url: '/s/2.xml', fingerings: { n2: 3 }, updated_at: 5000 }, // remote-only → pulled
      ],
    })

    const r = await runSync({ supabase, storage, practiceTracker })

    expect(r.fingeringsPushed).toBe(1)
    expect(r.fingeringsPulled).toBe(1)
    expect(supabase._fingerings.get('/s/1.xml').updated_at).toBe(2000)
    expect((await storage.getFingerings('/s/2.xml')).fingerings).toEqual({ n2: 3 })
  })
})
