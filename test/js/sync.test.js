import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installLocalStorage } from './support/browserGlobals.js'
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

describe('runSync', () => {
  let storage
  let practiceTracker
  let runSync
  let mergeFingerings
  let profiles

  // A page: fresh modules — profiles.js reads the profile the page is on when
  // it loads — and that profile's database.
  async function openPage() {
    vi.resetModules()
    ;({ runSync, mergeFingerings } = await import('../../public/js/sync.js'))
    profiles = await import('../../public/js/profiles.js')
    const { initStorage } = await import('../../public/js/storage.js')
    const { initPracticeTracker } = await import('../../public/js/practiceTracker.js')
    storage = initStorage()
    practiceTracker = initPracticeTracker(storage)
    await storage.init()
  }

  beforeEach(async () => {
    installLocalStorage()
    indexedDB = new IDBFactory()
    await openPage()
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

  describe('fingerings changed on both sides', () => {
    const URL_1 = '/s/1.xml'
    // The record as this device last exchanged it with the server, at 1000.
    const record = (fingerings, updatedAt, synced) => ({ scoreUrl: URL_1, fingerings, updatedAt, synced: { fingerings: synced, updatedAt: 1000 } })
    const serverRow = (fingerings, updatedAt) => ({ user_id: USER, score_url: URL_1, fingerings, updated_at: updatedAt })

    // The iPad left open for days adds n3 to its stale copy; the phone had
    // added n2 and synced. Each side used to replace the other whole.
    it('keeps what each side added since they last met', async () => {
      await storage.putFingeringRecord(record({ n1: 1, n3: 3 }, 3000, { n1: 1 }))
      const supabase = makeFakeSupabase({ fingerings: [serverRow({ n1: 1, n2: 2 }, 2000)] })

      await runSync({ supabase, storage, practiceTracker })

      const local = await storage.getFingerings(URL_1)
      expect(local.fingerings).toEqual({ n1: 1, n2: 2, n3: 3 })
      expect(supabase._fingerings.get(URL_1).fingerings).toEqual({ n1: 1, n2: 2, n3: 3 })
      expect(supabase._fingerings.get(URL_1).updated_at).toBe(local.updatedAt)
    })

    it('sends nothing on the next sync once the two agree', async () => {
      await storage.putFingeringRecord({ scoreUrl: URL_1, fingerings: { n1: 1 }, updatedAt: 1000 })
      const supabase = makeFakeSupabase()

      await runSync({ supabase, storage, practiceTracker })
      const second = await runSync({ supabase, storage, practiceTracker })

      expect(second.fingeringsPushed).toBe(0)
      expect(second.fingeringsPulled).toBe(0)
    })

    // Written back over the record as read, a sync would put back the version
    // it sent and drop the note entered while it was out.
    it('leaves a fingering entered during the sync for the next one', async () => {
      await storage.putFingeringRecord(record({ n1: 1 }, 2000, {}))
      const supabase = makeFakeSupabase({ fingerings: [serverRow({}, 1000)] })
      const from = supabase.from.bind(supabase)
      supabase.from = (name) => {
        const table = from(name)
        if (name !== 'user_fingerings') return table
        return { ...table, upsert: async (rows) => { await storage.setFingering(URL_1, 'n2', 2); return table.upsert(rows) } }
      }

      await runSync({ supabase, storage, practiceTracker })
      expect((await storage.getFingerings(URL_1)).fingerings).toEqual({ n1: 1, n2: 2 })

      supabase.from = from
      await runSync({ supabase, storage, practiceTracker })
      expect(supabase._fingerings.get(URL_1).fingerings).toEqual({ n1: 1, n2: 2 })
    })
  })

  // A sync writes a record back with its fingerings and its `synced` as one
  // map, and IndexedDB keeps them one: an edit made in place moved the base
  // along with it, and the next merge then took the edit for the server's.
  describe('fingerings entered after a sync', () => {
    const URL_1 = '/s/1.xml'

    it('are merged, not taken for the version the two last shared', async () => {
      await storage.putFingeringRecord({ scoreUrl: URL_1, fingerings: { n1: 1 }, updatedAt: 1000 })
      const supabase = makeFakeSupabase()
      await runSync({ supabase, storage, practiceTracker })

      await storage.setFingering(URL_1, 'n2', 2)
      supabase.from('user_fingerings').upsert([{ user_id: USER, profile_id: MAIN, score_url: URL_1, fingerings: { n1: 1, n3: 3 }, updated_at: 2000 }])
      await runSync({ supabase, storage, practiceTracker })

      expect(supabase._fingerings.get(URL_1).fingerings).toEqual({ n1: 1, n2: 2, n3: 3 })
    })

    // A score this device never had fingerings for: its first ones used to go
    // up whole, over those the phone had put there.
    it('join those another device entered first', async () => {
      await storage.setFingering(URL_1, 'n3', 3)
      const supabase = makeFakeSupabase({ fingerings: [{ user_id: USER, score_url: URL_1, fingerings: { n1: 1, n2: 2 }, updated_at: 1000 }] })

      await runSync({ supabase, storage, practiceTracker })

      expect(supabase._fingerings.get(URL_1).fingerings).toEqual({ n1: 1, n2: 2, n3: 3 })
    })
  })

  describe('mergeFingerings', () => {
    const merge = (mine, theirs, was, { mineAt = 3000, theirsAt = 2000 } = {}) =>
      mergeFingerings({ fingerings: mine, updatedAt: mineAt, synced: { fingerings: was } }, { fingerings: theirs, updatedAt: theirsAt })

    it('clears a note on one side when the other left it as it was', () => {
      expect(merge({ n1: 1 }, { n1: 1, n2: 2, n4: 4 }, { n1: 1, n2: 2 })).toEqual({ n1: 1, n4: 4 })
      expect(merge({ n1: 1, n2: 2, n4: 4 }, { n1: 1 }, { n1: 1, n2: 2 })).toEqual({ n1: 1, n4: 4 })
    })

    it('gives a note both sides changed to the newer record', () => {
      expect(merge({ n1: 5 }, { n1: 7 }, { n1: 1 })).toEqual({ n1: 5 })
      expect(merge({ n1: 5 }, { n1: 7 }, { n1: 1 }, { mineAt: 2000, theirsAt: 3000 })).toEqual({ n1: 7 })
    })
  })

  describe('profiles', () => {
    it('tags what it pushes with the profile the page is on, and pulls only that profile', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      profiles.switchProfile(charlie.id)
      await openPage()
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
      await openPage()
      await storage.saveSession(endedSession('c1', '/s/1.xml'))
      const supabase = makeFakeSupabase({
        profiles: [{ user_id: USER, id: charlie.id, name: '', avatar: '', updated_at: charlie.updatedAt + 1, deleted: true }],
      })

      const r = await runSync({ supabase, storage, practiceTracker })
      // The merge made the main profile the stored choice. A later sync from
      // the same page, still on Charlie's database, used to push Charlie's
      // practice as the main profile's.
      const second = await runSync({ supabase, storage, practiceTracker })

      expect(r.pushed + second.pushed).toBe(0)
      expect(supabase._sessions.size).toBe(0)
      expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
    })

    it('pushes nothing of a profile another tab has removed', async () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      profiles.switchProfile(charlie.id)
      await openPage()
      await storage.saveSession(endedSession('c1', '/s/1.xml'))
      profiles.removeProfile(charlie.id)

      const r = await runSync({ supabase: makeFakeSupabase(), storage, practiceTracker })

      expect(r.pushed).toBe(0)
    })
  })
})
