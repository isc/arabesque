import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

const USER = 'user-1'
// What every row from before profiles carries on the server.
const MAIN = 'main'

// Minimal fake of the Supabase client covering exactly the calls runSync makes:
// from(table).select(cols) filtered by .eq() and .in(), and .upsert(rows);
// plus auth.getUser(). Rows live in one map per table, keyed
// the way the real primary keys are.
const KEYS = {
  training_sessions: (r) => `${r.profile_id ?? MAIN}|${r.id}`,
  user_fingerings: (r) => `${r.profile_id ?? MAIN}|${r.score_url}`,
  profiles: (r) => r.id,
}

function makeFakeSupabase({ sessions = [], fingerings = [], profiles = [] } = {}) {
  const tables = { training_sessions: new Map(), user_fingerings: new Map(), profiles: new Map() }
  const seed = (name, rows) => rows.forEach((r) => tables[name].set(KEYS[name]({ profile_id: MAIN, ...r }), { profile_id: MAIN, ...r }))
  seed('training_sessions', sessions)
  seed('user_fingerings', fingerings)
  seed('profiles', profiles)

  const result = (rows, cols) => {
    const pick = (r) => (cols === '*' ? r : Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, r[c]])))
    return {
      get data() { return rows.map(pick) },
      error: null,
      eq: (col, val) => result(rows.filter((r) => r[col] === val), cols),
      in: (col, vals) => result(rows.filter((r) => vals.includes(r[col])), cols),
    }
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from(name) {
      const table = tables[name]
      return {
        select: (cols = '*') => result([...table.values()], cols),
        upsert(rows) {
          for (const r of rows) table.set(KEYS[name](r), { ...table.get(KEYS[name](r)), ...r })
          return { error: null }
        },
      }
    },
    _sessions: { keys: () => [...tables.training_sessions.values()].map((r) => r.id), get size() { return tables.training_sessions.size } },
    _fingerings: { get: (url) => [...tables.user_fingerings.values()].find((r) => r.score_url === url) },
    _profiles: tables.profiles,
    _rows: (name) => [...tables[name].values()],
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

// The page globals the modules touch (the suite runs in node): a localStorage
// for the profile list, fresh for every test along with the modules, since
// profiles.js caches what it read.
function installLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

describe('runSync', () => {
  let storage
  let practiceTracker
  let runSync
  let profiles

  beforeEach(async () => {
    installLocalStorage()
    vi.resetModules()
    indexedDB = new IDBFactory()
    ;({ runSync } = await import('../../public/js/sync.js'))
    profiles = await import('../../public/js/profiles.js')
    const { initStorage } = await import('../../public/js/storage.js')
    const { initPracticeTracker } = await import('../../public/js/practiceTracker.js')
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
    expect(supabase._sessions.keys().sort()).toEqual(['a', 'b'])
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

  describe('profiles', () => {
    it('tags what it pushes with the profile the page is on, and pulls only that profile', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      profiles.switchProfile(charlie.id)
      // The storage opened above is the main profile's; the page would have
      // opened Charlie's. What matters here is the rows, not the database.
      await storage.saveSession(endedSession('c1', '/s/1.xml'))
      await storage.putFingeringRecord({ scoreUrl: '/s/1.xml', fingerings: { n1: 2 }, updatedAt: 10 })
      const remote = endedSession('m1', '/s/2.xml')
      const supabase = makeFakeSupabase({
        sessions: [{ user_id: USER, profile_id: MAIN, id: 'm1', data: remote, ended_at: remote.endedAt }],
        fingerings: [{ user_id: USER, profile_id: MAIN, score_url: '/s/3.xml', fingerings: { x: 1 }, updated_at: 99 }],
      })

      const r = await runSync({ supabase, storage, practiceTracker })

      expect(r.pushed).toBe(1)
      expect(r.pulled).toBe(0)
      expect(r.fingeringsPulled).toBe(0)
      expect(supabase._rows('training_sessions').find((s) => s.id === 'c1').profile_id).toBe(charlie.id)
      expect(supabase._fingerings.get('/s/1.xml').profile_id).toBe(charlie.id)
      expect(await storage.getSession('m1')).toBeNull()
    })

    it('sends the profiles it knows and takes the ones it does not', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie', avatar: '🐻' })
      const supabase = makeFakeSupabase({
        profiles: [{ user_id: USER, id: 'p-phone', name: 'Léa', avatar: '🦊', updated_at: 5, deleted: false }],
      })

      const r = await runSync({ supabase, storage, practiceTracker })

      expect(r.profilesChanged).toBe(true)
      expect(supabase._profiles.get(charlie.id)).toMatchObject({ user_id: USER, name: 'Charlie', avatar: '🐻', deleted: false })
      expect(supabase._profiles.get(MAIN)).toMatchObject({ user_id: USER, name: '' })
      expect(profiles.listProfiles().map((p) => p.name)).toEqual(['', 'Charlie', 'Léa'])
    })

    it('carries a removal to the server as a tombstone', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      const supabase = makeFakeSupabase({
        profiles: [{ user_id: USER, id: charlie.id, name: 'Charlie', avatar: '🎹', updated_at: charlie.updatedAt, deleted: false }],
      })
      profiles.removeProfile(charlie.id)

      await runSync({ supabase, storage, practiceTracker })

      // The server drops the profile's rows on its own (supabase/sync.sql).
      expect(supabase._profiles.get(charlie.id)).toMatchObject({ user_id: USER, deleted: true })
    })

    it('drops a profile removed on another device, and pushes nothing of it', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      profiles.switchProfile(charlie.id)
      await storage.saveSession(endedSession('c1', '/s/1.xml'))
      const supabase = makeFakeSupabase({
        profiles: [{ user_id: USER, id: charlie.id, name: '', avatar: '', updated_at: charlie.updatedAt + 1, deleted: true }],
      })

      const r = await runSync({ supabase, storage, practiceTracker })

      expect(r.pushed).toBe(0)
      expect(supabase._sessions.size).toBe(0)
      expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
    })
  })
})
