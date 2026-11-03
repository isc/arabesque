import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PERIODS, getPeriodForComposer } from '../../public/js/musicalPeriods.js'
import { partsOf } from '../../public/js/catalog.js'
import { searchWords, partsAnswering } from '../../public/js/utils.js'

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

describe('partsAnswering', () => {
  const chansons = scores.find((score) => score.title === 'Chansons')
  const moonlight = scores.find((score) => score.title.startsWith('Moonlight'))
  const answering = (score, query) => partsAnswering(score, searchWords(query)).map((part) => part.title)

  it('finds a part by its title, whatever the accents and the case', () => {
    expect(answering(chansons, 'Fais dodo')).toEqual(['Fais dodo'])
    expect(answering(chansons, 'la lecon')).toEqual(['La leçon'])
  })

  it('finds every part when the search names the entry itself', () => {
    expect(answering(chansons, 'chansons')).toHaveLength(chansons.parts.length)
    expect(answering(chansons, 'traditionnel')).toHaveLength(chansons.parts.length)
  })

  it('weighs the entry and one part together', () => {
    expect(answering(chansons, 'traditionnel dodo')).toEqual(['Fais dodo'])
  })

  it('does not piece a search together from two parts', () => {
    expect(answering(chansons, 'dodo maman')).toEqual([])
  })

  it('prefers the parts whose own title answers the whole search', () => {
    const hanon = scores.find((score) => score.title === 'Le Pianiste virtuose (1re partie)')
    expect(answering(hanon, 'exercice 1')[0]).toBe('Exercice 1')
    expect(answering(hanon, 'exercice 1')).not.toContain('Exercice 2')
  })

  it('takes an entry without parts as its own one part', () => {
    expect(partsAnswering(moonlight, searchWords('moonlight'))).toEqual([moonlight])
    expect(partsAnswering(moonlight, searchWords('dodo'))).toEqual([])
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
