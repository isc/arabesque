import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PERIODS, getPeriodForComposer } from '../../public/js/musicalPeriods.js'
import { partsOf } from '../../public/js/catalog.js'

// public/data/scores.json is the catalog, and things are kept beside it by
// hand: the files, and a period for each composer here; the fingerprints in
// fingerprints.test.js. Each test is the one an addition fails when it forgets
// one.
const PUBLIC = join(import.meta.dirname, '..', '..', 'public')
const readJson = (path) => JSON.parse(readFileSync(join(PUBLIC, path), 'utf8'))
const { scores } = readJson('data/scores.json')
const catalogFiles = scores.flatMap((score) => partsOf(score).map((part) => part.file))

describe('the score catalog', () => {
  it('lists every file in public/scores/, once', () => {
    expect(catalogFiles.toSorted()).toEqual(readdirSync(join(PUBLIC, 'scores')).toSorted())
  })

  it('gives every composer a musical period', () => {
    const composers = [...new Set(scores.map((score) => score.composer))]
    expect(composers.filter((composer) => !PERIODS.includes(getPeriodForComposer(composer)))).toEqual([])
  })
})

describe('loadCatalog', () => {
  // A module of its own per test: the catalog is read once per page.
  let loadCatalog
  beforeEach(async () => {
    vi.resetModules()
    ;({ loadCatalog } = await import('../../public/js/catalog.js'))
  })

  const serve = (catalog) => vi.fn(async () => ({ json: async () => catalog }))

  it('files each part of a collection apart, under its own title and the collection’s composer', async () => {
    vi.stubGlobal('fetch', serve({
      baseUrl: 'scores/',
      scores: [
        { title: 'Swan Lake', composer: 'Tchaikovsky', file: 'swan.mxl' },
        { title: 'Le Pianiste virtuose', composer: 'Hanon', parts: [{ title: 'Exercice 1', file: 'hanon-1.mxl' }, { title: 'Exercice 2', file: 'hanon-2.mxl' }] },
      ],
    }))

    const { byUrl } = await loadCatalog()

    expect(byUrl.get('scores/swan.mxl')).toMatchObject({ index: 0, name: { title: 'Swan Lake', composer: 'Tchaikovsky' } })
    expect(byUrl.get('scores/hanon-2.mxl')).toMatchObject({ index: 1, name: { title: 'Exercice 2', composer: 'Hanon' } })
    expect(byUrl.get('scores/hanon-2.mxl').score.title).toBe('Le Pianiste virtuose')
    expect(byUrl.has('scores/elsewhere.mxl')).toBe(false)
  })

  it('reads the catalog once, and again after a read that failed', async () => {
    const fetch = serve({ baseUrl: 'scores/', scores: [] })
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    vi.stubGlobal('fetch', fetch)

    await expect(loadCatalog()).rejects.toThrow('offline')
    await loadCatalog()
    await loadCatalog()

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
