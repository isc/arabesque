import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PERIODS, getPeriodForComposer } from '../../public/js/musicalPeriods.js'

// public/data/scores.json is the catalog, and three things are kept beside it
// by hand. Each test here is the one an addition fails when it forgets one.
const PUBLIC = join(import.meta.dirname, '..', '..', 'public')
const readJson = (path) => JSON.parse(readFileSync(join(PUBLIC, path), 'utf8'))
const { scores } = readJson('data/scores.json')
// A collection is one row of the library but one file per part.
const catalogFiles = scores.flatMap((score) => (score.parts ? score.parts.map((part) => part.file) : [score.file]))

describe('the score catalog', () => {
  it('lists every file in public/scores/, once', () => {
    expect(catalogFiles.toSorted()).toEqual(readdirSync(join(PUBLIC, 'scores')).toSorted())
  })

  // What finds a score from its opening played on the MIDI keyboard; see
  // CLAUDE.md for regenerating them.
  it('has a fingerprint for every score file', () => {
    const fingerprinted = readJson('data/fingerprints.json').fingerprints.map((fp) => fp.file)
    expect(fingerprinted.toSorted()).toEqual(catalogFiles.toSorted())
  })

  it('gives every composer a musical period', () => {
    const composers = [...new Set(scores.map((score) => score.composer))]
    expect(composers.filter((composer) => !PERIODS.includes(getPeriodForComposer(composer)))).toEqual([])
  })
})
