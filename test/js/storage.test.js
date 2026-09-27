import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage } from '../../public/js/storage.js'

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
