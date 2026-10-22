import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage, neverSynced, STORES, DB_VERSION } from '../../public/js/storage.js'
import { initPracticeTracker } from '../../public/js/practiceTracker.js'
import { importBackup } from '../../public/js/sync.js'

const measures = [{ sourceMeasureIndex: 0, attempts: [{ startedAt: '2026-06-10T10:00:00.000Z', durationMs: 60_000, wrongNotes: 0, clean: true }] }]
const session = (id) => ({ id, scoreId: 'scores/a.mxl', startedAt: '2026-06-10T10:00:00.000Z', endedAt: '2026-06-10T10:01:00.000Z', measures })

// A device of its own: an empty database, and the tracker that reads it.
async function aDevice() {
  indexedDB = new IDBFactory()
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)
  await storage.init()
  return { storage, practiceTracker }
}

// A backup brought to a device that has practice of its own joins it, the way
// a sync's pull does: it used to be written over it.
describe('importing a backup', () => {
  let storage
  let practiceTracker

  beforeEach(async () => {
    ;({ storage, practiceTracker } = await aDevice())
  })

  it('keeps a score’s fingerings entered here since the backup was made', async () => {
    await storage.fingerings.put({ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 2000 })

    const { importedFingerings } = await importBackup({ storage, practiceTracker }, {
      sessions: [],
      fingerings: [
        { scoreUrl: 'scores/a.mxl', fingerings: { n1: 1 }, updatedAt: 1000 },
        { scoreUrl: 'scores/b.mxl', fingerings: { n2: 2 }, updatedAt: 1000 },
      ],
    })

    expect(importedFingerings).toBe(1)
    expect((await storage.fingerings.get('scores/a.mxl')).fingerings).toEqual({ n1: 3 })
    expect((await storage.fingerings.get('scores/b.mxl')).fingerings).toEqual({ n2: 2 })
  })

  // Entered as if played here: the notes the backup adds join the record, and
  // the new stamp, past what the record last exchanged, is what the next sync
  // reads as a change to send.
  it('adds the backup’s notes to the ones here, for the next sync to send', async () => {
    const synced = { fingerings: { n1: 3 }, updatedAt: 2000 }
    await storage.fingerings.put({ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 2000, synced })

    await importBackup({ storage, practiceTracker }, { sessions: [], fingerings: [{ scoreUrl: 'scores/a.mxl', fingerings: { n2: 2 }, updatedAt: 1000 }] })

    const record = await storage.fingerings.get('scores/a.mxl')
    expect(record.fingerings).toEqual({ n1: 3, n2: 2 })
    expect(record.updatedAt).toBeGreaterThan(2000)
    expect(record.synced).toEqual(synced)
  })

  // A record new here merges into the server's copy at the next sync, as one
  // entered here would: taken whole, it would replace what the server holds.
  it('gives a score new to this device the base a new record starts from', async () => {
    await importBackup({ storage, practiceTracker }, { sessions: [], fingerings: [{ scoreUrl: 'scores/b.mxl', fingerings: { n2: 2 }, updatedAt: 1000 }] })

    expect((await storage.fingerings.get('scores/b.mxl')).synced).toEqual(neverSynced('fingerings'))
  })

  // The backup's aggregates only lend their names, below this device's own:
  // an untitled row in the file used to leave the score untitled here.
  it('counts the imported practice alongside this device’s, keeping its names', async () => {
    await storage.saveSession(session('here'))
    await storage.saveAggregate({ scoreId: 'scores/a.mxl', scoreTitle: 'Gymnopédie', totalSessions: 1 })

    const { importedSessions } = await importBackup({ storage, practiceTracker }, {
      sessions: [session('here'), session('there')],
      aggregates: [{ scoreId: 'scores/a.mxl', scoreTitle: null }],
    })

    expect(importedSessions).toBe(1)
    const aggregate = await storage.getAggregate('scores/a.mxl')
    expect(aggregate.totalSessions).toBe(2)
    expect(aggregate.scoreTitle).toBe('Gymnopédie')
  })
})

// A backup's circles join those here as its fingerings do, note by note:
// the reminder of a note both hold is the newer side's.
describe('importing a backup with circles', () => {
  it('adds the backup’s circles to the ones here, keeping a reminder rewritten since', async () => {
    const { storage, practiceTracker } = await aDevice()
    await storage.circles.put({ scoreUrl: 'scores/a.mxl', circles: { n1: 'fa, pas fa♯' }, updatedAt: 2000 })

    const { importedCircles } = await importBackup({ storage, practiceTracker }, {
      sessions: [],
      circles: [
        { scoreUrl: 'scores/a.mxl', circles: { n1: 'fa', n2: '' }, updatedAt: 1000 },
        { scoreUrl: 'scores/b.mxl', circles: { n3: 'lent' }, updatedAt: 1000 },
      ],
    })

    expect(importedCircles).toBe(2)
    expect((await storage.circles.get('scores/a.mxl')).circles).toEqual({ n1: 'fa, pas fa♯', n2: '' })
    expect((await storage.circles.get('scores/b.mxl')).circles).toEqual({ n3: 'lent' })
  })
})

describe('circles', () => {
  // Kept apart from the fingerings: a build that knows only fingerings writes
  // their record whole, and would drop what it does not know (storage.js).
  it('are kept per note, a circle with no reminder included, apart from the fingerings', async () => {
    const { storage } = await aDevice()
    await storage.fingerings.set('scores/a.mxl', 'n1', 3)
    await storage.circles.set('scores/a.mxl', 'n1', '')
    await storage.circles.set('scores/a.mxl', 'n2', 'fa, pas fa♯')
    await storage.circles.remove('scores/a.mxl', 'n2')

    expect((await storage.circles.get('scores/a.mxl')).circles).toEqual({ n1: '' })
    expect((await storage.fingerings.get('scores/a.mxl')).fingerings).toEqual({ n1: 3 })
  })

  it('start from the base a record new to this device has', async () => {
    const { storage } = await aDevice()
    expect(await storage.circles.get('scores/a.mxl')).toEqual({ scoreUrl: 'scores/a.mxl', circles: {}, synced: neverSynced('circles') })
  })
})

// `synced` is this device's own exchange with the server (sync.js): another
// device importing it would merge against a version it never had.
describe('a backup', () => {
  it('leaves out what a fingering or circle record last exchanged with the server', async () => {
    indexedDB = new IDBFactory()
    const storage = initStorage()
    await storage.fingerings.put({ scoreUrl: 's', fingerings: { n1: 1 }, updatedAt: 5, synced: { fingerings: { n1: 1 }, updatedAt: 5 } })
    await storage.circles.put({ scoreUrl: 's', circles: { n1: '' }, updatedAt: 5, synced: { circles: { n1: '' }, updatedAt: 5 } })

    const backup = await storage.exportBackup()
    expect(backup.fingerings).toEqual([{ scoreUrl: 's', fingerings: { n1: 1 }, updatedAt: 5 }])
    expect(backup.circles).toEqual([{ scoreUrl: 's', circles: { n1: '' }, updatedAt: 5 }])
  })
})

// Moving to another device through a backup brings every store it carries
// over, the aggregates rebuilt from the sessions with the names the backup
// lends them. A store the backup carries but importBackup does not read fails
// here, and every such store needs a record below, so a new one cannot slip
// past.
describe('a backup restored on another device', () => {
  // A record of each store, and how storage writes it.
  const records = {
    fingerings: [{ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 5 }, (storage, record) => storage.fingerings.put(record)],
    circles: [{ scoreUrl: 'scores/a.mxl', circles: { n1: 'fa, pas fa♯', n2: '' }, updatedAt: 5 }, (storage, record) => storage.circles.put(record)],
    sessions: [session('s1'), (storage, record) => storage.saveSession(record)],
    aggregates: [{ scoreId: 'scores/a.mxl', scoreTitle: 'Gymnopédie' }, (storage, record) => storage.saveAggregate(record)],
  }

  // A store is only created by the upgrade to a new version: one added without
  // DB_VERSION raised never reaches a device that already has the database,
  // and a backup there fails on it. The stores each version shipped with:
  const STORES_BY_VERSION = {
    4: ['aggregates', 'fingerings', 'noteLogs', 'sessions'],
    5: ['aggregates', 'fingerings', 'keptNoteLogs', 'noteLogs', 'sessions'],
    6: ['aggregates', 'circles', 'fingerings', 'keptNoteLogs', 'noteLogs', 'sessions'],
  }

  it('raises the database version with every store added', () => {
    expect([...STORES].sort()).toEqual(STORES_BY_VERSION[DB_VERSION])
  })

  it('has a record of every store to carry', async () => {
    const { storage } = await aDevice()
    const { exportDate, ...stores } = await storage.exportBackup()
    expect(Object.keys(records).sort()).toEqual(Object.keys(stores).sort())
  })

  // Raw material for the analysis, megabytes of it, kept a few weeks only.
  it('leaves the note logs out, sent or not', async () => {
    const { storage } = await aDevice()
    await storage.saveNoteLog(noteLog('s1:0'))
    await storage.saveKeptNoteLogs([noteLog('s2:0')])
    const backup = await storage.exportBackup()
    expect(backup).not.toHaveProperty('noteLogs')
    expect(backup).not.toHaveProperty('keptNoteLogs')
  })

  it('brings every store back', async () => {
    const { storage } = await aDevice()
    for (const [record, write] of Object.values(records)) await write(storage, record)
    const backup = JSON.parse(JSON.stringify(await storage.exportBackup()))

    const elsewhere = await aDevice()
    await importBackup(elsewhere, backup)
    const restored = await elsewhere.storage.exportBackup()

    for (const store of Object.keys(records)) expect(restored[store], store).toMatchObject(backup[store])
  })
})

const noteLog = (id) => ({ id, sessionId: id.split(':')[0], startedAt: '2026-06-10T10:00:00.000Z', t: [0], e: 'd', p: [60], v: [64], n: [0], b: [0], keys: ['m1:0:0:0'] })

// A branch preview is on production's origin, and on its database: one that
// raised DB_VERSION leaves it a version ahead of production.
describe('a database a newer build upgraded', () => {
  it('opens as it stands, with every store this build knows', async () => {
    indexedDB = new IDBFactory()
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('arabesque', DB_VERSION + 1)
      request.onupgradeneeded = () => {
        for (const store of [...STORES, 'fromTheFuture']) request.result.createObjectStore(store, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    const storage = initStorage()
    await storage.init()
    await storage.saveSession(session('s1'))
    expect((await storage.getSessions()).map((s) => s.id)).toEqual(['s1'])
  })
})

describe('note logs', () => {
  // A session's id opens on the epoch ms it started at (practiceTracker.js).
  it('drops the segments of the sessions started before an instant', async () => {
    const { storage } = await aDevice()
    for (const id of ['1700000000000-old:0', '1700000000000-old:1', '1800000000000-new:0']) await storage.saveNoteLog(noteLog(id))

    await storage.saveKeptNoteLogs([noteLog('1700000000000-sent:0'), noteLog('1800000000000-sent:0')])

    await storage.deleteNoteLogsBefore(1750000000000)
    expect(await storage.getNoteLogIds()).toEqual(['1800000000000-new:0'])
    expect((await storage.getHeldNoteLogIds()).sort()).toEqual(['1800000000000-new:0', '1800000000000-sent:0'])
  })

  // Once the server has them, segments are kept for the analysis rather than
  // dropped, and none is ever sent twice.
  it('keeps the segments the server has apart from those still to send', async () => {
    const { storage } = await aDevice()
    for (const id of ['s1:0', 's1:1', 's2:0']) await storage.saveNoteLog(noteLog(id))

    await storage.keepNoteLogs(['s1:0', 's1:1'])
    expect(await storage.getNoteLogIds()).toEqual(['s2:0'])
    expect((await storage.getHeldNoteLogIds()).sort()).toEqual(['s1:0', 's1:1', 's2:0'])
  })

  it('reads the segments of sessions, sent or not, in their order past the ninth', async () => {
    const { storage } = await aDevice()
    const ids = Array.from({ length: 12 }, (_, n) => `s1:${n}`)
    await storage.saveKeptNoteLogs(ids.slice(0, 6).map(noteLog))
    for (const id of ids.slice(6)) await storage.saveNoteLog(noteLog(id))
    await storage.saveNoteLog(noteLog('s10:0'))

    const read = async (sessionIds) => (await storage.getNoteLogsOfSessions(sessionIds)).map((segments) => segments.map((s) => s.id))
    expect(await read(['s1'])).toEqual([ids])
    expect(await read(['s10', 's1', 's2'])).toEqual([['s10:0'], ids, []])
  })

  it('drops the kept segments of sessions, never one still to send', async () => {
    const { storage } = await aDevice()
    await storage.saveKeptNoteLogs([noteLog('s1:0'), noteLog('s10:0'), noteLog('s2:0')])
    await storage.saveNoteLog(noteLog('s1:1'))

    await storage.deleteKeptNoteLogsOfSessions(['s1'])
    expect((await storage.getHeldNoteLogIds()).sort()).toEqual(['s10:0', 's1:1', 's2:0'])
  })

  it('adds a segment only where none is held under its id', async () => {
    const { storage } = await aDevice()
    await storage.saveNoteLog({ ...noteLog('s1:0'), e: 'du' })
    await expect(storage.addNoteLog(noteLog('s1:0'))).rejects.toMatchObject({ name: 'ConstraintError' })
    expect((await storage.getNoteLogsById(['s1:0']))[0].e).toBe('du')
  })
})

describe('sessions by start', () => {
  it('reads those started from the first instant up to, not including, the last', async () => {
    const { storage } = await aDevice()
    const startedAt = (iso) => ({ ...session(iso), startedAt: iso })
    for (const iso of ['2026-06-09T23:59:59.999Z', '2026-06-10T00:00:00.000Z', '2026-06-10T23:59:59.999Z', '2026-06-11T00:00:00.000Z']) {
      await storage.saveSession(startedAt(iso))
    }

    const read = await storage.getSessionsStartedBetween(new Date('2026-06-10T00:00:00.000Z'), new Date('2026-06-11T00:00:00.000Z'))

    expect(read.map((s) => s.startedAt)).toEqual(['2026-06-10T00:00:00.000Z', '2026-06-10T23:59:59.999Z'])
  })
})

// close() stands in for WebKit dropping the connection under the page: both
// leave transaction() throwing "The database connection is closing". See withDb.
describe('storage on a lost connection', () => {
  let storage

  const session = { id: 's1', scoreId: 'scores/a.mxl', startedAt: '2026-09-23T19:00:00.000Z', measures: [] }

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    storage = initStorage()
    await storage.saveSession(session)
    ;(await storage.init()).close()
  })

  it('reads through a fresh connection', async () => {
    expect(await storage.getSessions()).toEqual([session])
    expect(await storage.getSession('s1')).toEqual(session)
  })

  it('writes through a fresh connection', async () => {
    await storage.saveAggregate({ scoreId: 'scores/a.mxl', status: 'dechiffrage' })
    expect(await storage.getAllAggregates()).toHaveLength(1)

    await storage.replaceAggregates([{ scoreId: 'scores/b.mxl', status: 'repertoire' }])
    expect(await storage.getAllAggregates()).toEqual([{ scoreId: 'scores/b.mxl', status: 'repertoire' }])
  })

  // A wake-up redraw reads several stores at once, and each finds the
  // connection dead on its own.
  it('reopens once for the reads that found the connection dead together', async () => {
    const open = vi.spyOn(indexedDB, 'open')

    await Promise.all([storage.getSessions(), storage.getAllAggregates(), storage.fingerings.getAll()])

    expect(open).toHaveBeenCalledTimes(1)
  })
})

// A page left while it creates the database abandons the upgrade, which
// Chrome would otherwise keep every later open waiting behind (openDatabase).
// There is no page to leave where these tests run: one stands in here.
describe('a page left while the database is created', () => {
  let leave
  let comeBack
  // Handed each open's upgrade, ahead of storage.js's own handler.
  let onUpgrade

  beforeEach(() => {
    indexedDB = new IDBFactory()
    const page = new EventTarget()
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
    leave = () => page.dispatchEvent(new Event('pagehide'))
    comeBack = () => page.dispatchEvent(new Event('pageshow'))
    onUpgrade = () => {}
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (...args) => {
      const request = open(...args)
      request.addEventListener('upgradeneeded', () => onUpgrade(request.transaction))
      return request
    }
  })

  // Abandoned, not failed: a rejection on a page being left is caught by
  // nothing, and lands in the errors a feedback report carries.
  it('abandons an upgrade still under way, and starts it again when the page comes back', async () => {
    const storage = initStorage()
    let aborted = false
    onUpgrade = (upgrade) => {
      onUpgrade = () => {}
      upgrade.addEventListener('abort', () => (aborted = true))
      queueMicrotask(leave)
    }
    let settled = false
    const opening = storage.init()
    opening.then(() => (settled = true), () => (settled = true))
    await vi.waitFor(() => expect(aborted).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    comeBack()
    expect([...(await opening).objectStoreNames]).toEqual([...STORES].sort())
  })

  // The upgrade is over a moment before storage.js hears of it, from its
  // complete event. A listener of that event ahead of storage.js's own leaves
  // the page in that moment, where abort() used to throw: uncaught, here as in
  // the browser, and vitest fails the run on it.
  it('leaves an upgrade that is over alone', async () => {
    const storage = initStorage()
    onUpgrade = (upgrade) => upgrade.addEventListener('complete', leave)

    expect([...(await storage.init()).objectStoreNames]).toEqual([...STORES].sort())
  })
})

// An operation that neither succeeds nor fails reaches no catch block, and a
// report sent from a page waiting on one said nothing of it (watchStall).
describe('a database that does not answer', () => {
  let logged

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    logged.mockRestore()
  })

  // What recordError (errorLog.js) logs as it keeps an error for a report.
  const recorded = () => logged.mock.calls.filter(([where]) => where === 'Storage:').map(([, error]) => error.message)

  it('is recorded once it has stalled, and again when it lands', async () => {
    vi.useFakeTimers()
    const request = {}
    vi.stubGlobal('indexedDB', { databases: async () => [], open: () => request })
    const opened = initStorage().init()

    await vi.advanceTimersByTimeAsync(4999)
    expect(recorded()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(recorded()).toEqual(['IndexedDB open still pending after 5s'])

    await vi.advanceTimersByTimeAsync(7000)
    request.result = {}
    request.onsuccess()
    await opened
    expect(recorded()).toEqual(['IndexedDB open still pending after 5s', 'IndexedDB open settled after 12s'])
  })

  it('records an upgrade another connection holds up, and then goes through', async () => {
    indexedDB = new IDBFactory()
    const older = await new Promise((resolve) => {
      const request = indexedDB.open('arabesque', DB_VERSION - 1)
      request.onsuccess = () => resolve(request.result)
    })
    const opened = initStorage().init()

    await vi.waitFor(() => expect(recorded()).toEqual([`IndexedDB open of version ${DB_VERSION} blocked by another connection`]))
    older.close()
    expect((await opened).version).toBe(DB_VERSION)
  })

  it('records one stall at a time: the first, which the others queue behind', async () => {
    const request = {}
    const reads = []
    const store = { getAll: () => reads[reads.push({}) - 1] }
    vi.stubGlobal('indexedDB', { databases: async () => [], open: () => request })
    const storage = initStorage()
    const opened = storage.init()
    await vi.waitFor(() => expect(request.onsuccess).toBeTypeOf('function'))
    request.result = { transaction: () => ({ objectStore: () => store }) }
    request.onsuccess()
    await opened

    vi.useFakeTimers()
    const both = Promise.all([storage.getSessions(), storage.getAllAggregates()])
    await vi.advanceTimersByTimeAsync(5000)
    for (const read of reads) read.onsuccess()
    await both

    expect(recorded()).toEqual(['IndexedDB readonly sessions still pending after 5s', 'IndexedDB readonly sessions settled after 5s'])
  })
})
