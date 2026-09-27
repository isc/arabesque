import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage } from '../../public/js/storage.js'
import { initPracticeTracker } from '../../public/js/practiceTracker.js'
import { importBackup } from '../../public/js/sync.js'

// A backup brought to a device that has practice of its own joins it, the way
// a sync's pull does: it used to be written over it.
describe('importing a backup', () => {
  let storage
  const measures = [{ sourceMeasureIndex: 0, attempts: [{ startedAt: '2026-06-10T10:00:00.000Z', durationMs: 60_000, wrongNotes: 0, clean: true }] }]
  const session = (id) => ({ id, scoreId: 'scores/a.mxl', startedAt: '2026-06-10T10:00:00.000Z', endedAt: '2026-06-10T10:01:00.000Z', measures })

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    storage = initStorage()
    await storage.init()
  })

  it('keeps a score’s fingerings entered here since the backup was made', async () => {
    await storage.putFingeringRecord({ scoreUrl: 'scores/a.mxl', fingerings: { n1: 3 }, updatedAt: 2000 })

    const { importedFingerings } = await storage.importBackup({
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

  // The backup's aggregates only lend their names, below this device's own:
  // an untitled row in the file used to leave the score untitled here.
  it('counts the imported practice alongside this device’s, keeping its names', async () => {
    const practiceTracker = initPracticeTracker(storage)
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
