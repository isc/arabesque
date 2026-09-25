import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage } from '../../public/js/storage.js'

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

    await storage.clearAggregates()
    expect(await storage.getAllAggregates()).toEqual([])
  })

  // A wake-up redraw reads several stores at once, and each finds the
  // connection dead on its own.
  it('reopens once for the reads that found the connection dead together', async () => {
    const open = vi.spyOn(indexedDB, 'open')

    await Promise.all([storage.getSessions(), storage.getAllAggregates(), storage.getAllFingerings()])

    expect(open).toHaveBeenCalledTimes(1)
  })
})
