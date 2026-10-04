import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage, NEVER_SYNCED, STORES, DB_VERSION } from '../../public/js/storage.js'
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
    await storage.putFingeringRecord({ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 2000 })

    const { importedFingerings } = await importBackup({ storage, practiceTracker }, {
      sessions: [],
      fingerings: [
        { scoreUrl: 'scores/a.mxl', fingerings: { n1: 1 }, updatedAt: 1000 },
        { scoreUrl: 'scores/b.mxl', fingerings: { n2: 2 }, updatedAt: 1000 },
      ],
    })

    expect(importedFingerings).toBe(1)
    expect((await storage.getFingerings('scores/a.mxl')).fingerings).toEqual({ n1: 3 })
    expect((await storage.getFingerings('scores/b.mxl')).fingerings).toEqual({ n2: 2 })
  })

  // Entered as if played here: the notes the backup adds join the record, and
  // the new stamp, past what the record last exchanged, is what the next sync
  // reads as a change to send.
  it('adds the backup’s notes to the ones here, for the next sync to send', async () => {
    const synced = { fingerings: { n1: 3 }, updatedAt: 2000 }
    await storage.putFingeringRecord({ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 2000, synced })

    await importBackup({ storage, practiceTracker }, { sessions: [], fingerings: [{ scoreUrl: 'scores/a.mxl', fingerings: { n2: 2 }, updatedAt: 1000 }] })

    const record = await storage.getFingerings('scores/a.mxl')
    expect(record.fingerings).toEqual({ n1: 3, n2: 2 })
    expect(record.updatedAt).toBeGreaterThan(2000)
    expect(record.synced).toEqual(synced)
  })

  // A record new here merges into the server's copy at the next sync, as one
  // entered here would: taken whole, it would replace what the server holds.
  it('gives a score new to this device the base a new record starts from', async () => {
    await importBackup({ storage, practiceTracker }, { sessions: [], fingerings: [{ scoreUrl: 'scores/b.mxl', fingerings: { n2: 2 }, updatedAt: 1000 }] })

    expect((await storage.getFingerings('scores/b.mxl')).synced).toEqual(NEVER_SYNCED)
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

// `synced` is this device's own exchange with the server (sync.js): another
// device importing it would merge against a version it never had.
describe('a backup', () => {
  it('leaves out what a fingering record last exchanged with the server', async () => {
    indexedDB = new IDBFactory()
    const storage = initStorage()
    await storage.putFingeringRecord({ scoreUrl: 's', fingerings: { n1: 1 }, updatedAt: 5, synced: { fingerings: { n1: 1 }, updatedAt: 5 } })

    expect((await storage.exportBackup()).fingerings).toEqual([{ scoreUrl: 's', fingerings: { n1: 1 }, updatedAt: 5 }])
  })
})

// Moving to another device through a backup brings every store over, the
// aggregates rebuilt from the sessions with the names the backup lends them. A
// store the backup carries but importBackup does not read fails here, and
// every store needs a record below, so a new one cannot slip past.
describe('a backup restored on another device', () => {
  // A record of each store, and the storage method that writes it.
  const records = {
    fingerings: [{ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 5 }, 'putFingeringRecord'],
    sessions: [session('s1'), 'saveSession'],
    aggregates: [{ scoreId: 'scores/a.mxl', scoreTitle: 'Gymnopédie' }, 'saveAggregate'],
  }

  // A store is only created by the upgrade to a new version: one added without
  // DB_VERSION raised never reaches a device that already has the database,
  // and a backup there fails on it. The stores each version shipped with:
  const STORES_BY_VERSION = { 3: ['aggregates', 'fingerings', 'sessions'] }

  it('raises the database version with every store added', () => {
    expect([...STORES].sort()).toEqual(STORES_BY_VERSION[DB_VERSION])
  })

  it('has a record of every store to carry', () => {
    expect(Object.keys(records).sort()).toEqual([...STORES].sort())
  })

  it('brings every store back', async () => {
    const { storage } = await aDevice()
    for (const [record, write] of Object.values(records)) await storage[write](record)
    const backup = JSON.parse(JSON.stringify(await storage.exportBackup()))

    const elsewhere = await aDevice()
    await importBackup(elsewhere, backup)
    const restored = await elsewhere.storage.exportBackup()

    for (const store of STORES) expect(restored[store], store).toMatchObject(backup[store])
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

    await Promise.all([storage.getSessions(), storage.getAllAggregates(), storage.getAllFingerings()])

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
