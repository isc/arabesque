import { describe, it, expect } from 'vitest'
import {
  barCounter,
  fileNumbering,
  fingeringKey,
  isLegacyFingeringKey,
  legacyFingeringKey,
  migrateLegacyFingerings,
  nextNoteIndex,
} from '../../public/js/fingeringKeys.js'

describe('fingering keys', () => {
  it('tells a current key from one written under the old scheme', () => {
    expect(isLegacyFingeringKey(fingeringKey(0, 0, 0, 0))).toBe(false)
    // The measure numbers the old scheme put first: an ordinary one, the "0"
    // Satie's barless Gnossienne prints on all eleven of its measures, and the
    // two an unparsable number ("X1", a second ending) turned into.
    for (const measureNumber of [1, 0, NaN, null]) {
      expect(isLegacyFingeringKey(legacyFingeringKey(measureNumber, 0, 0, 0))).toBe(true)
    }
  })

  it('counts each staff and voice of a measure on its own', () => {
    const counters = new Map()
    expect([
      nextNoteIndex(counters, 0, 0),
      nextNoteIndex(counters, 0, 0),
      nextNoteIndex(counters, 1, 0),
      nextNoteIndex(counters, 0, 1),
      nextNoteIndex(counters, 0, 0),
    ]).toEqual([0, 1, 0, 0, 2])
  })
})

// The bar each measure lands in, given [number, implicit] per <measure>.
const barIndexes = (measures) => {
  const nextBar = barCounter()
  return measures.map(([number, implicit]) => nextBar(number, implicit).index)
}

describe('barCounter', () => {
  it('gives each measure a bar of its own, a pickup included', () => {
    expect(barIndexes([[0, true], [1, false], [2, false]])).toEqual([0, 1, 2])
  })

  it('folds the second half of a split bar into the bar it completes', () => {
    expect(barIndexes([[31, false], [32, false], [32, true], [33, false]])).toEqual([0, 1, 1, 2])
  })

  it('folds every further piece of a bar split more than once', () => {
    expect(barIndexes([[32, false], [32, true], [32, true], [33, false]])).toEqual([0, 0, 0, 1])
  })

  // Satie's barless Gnossienne: every measure implicit, every one numbered 0.
  it('keeps apart implicit measures that complete no counted bar', () => {
    expect(barIndexes([[0, true], [0, true], [0, true]])).toEqual([0, 1, 2])
  })

  it('keeps apart a repeated number that is not marked implicit', () => {
    expect(barIndexes([[4, false], [4, false]])).toEqual([0, 1])
  })

  // A second ending exported "X1", which parseInt reads as NaN.
  it('keeps apart an implicit measure whose number cannot be read', () => {
    expect(barIndexes([[19, false], [NaN, true], [NaN, true]])).toEqual([0, 1, 2])
  })
})

// A file as its walk reads it: parts of [declared staves, measures], a measure
// [number, implicit, notes], a note [staff, voice] as the file writes them.
function fileKeys(parts) {
  const numbering = fileNumbering()
  const keys = []
  for (const [staves, measures] of parts) {
    numbering.part(staves)
    for (const [number, implicit, notes] of measures) {
      numbering.measure(number, implicit)
      for (const [staff, voice] of notes) keys.push(numbering.note(staff, voice).key)
    }
  }
  return keys
}

describe('fileNumbering', () => {
  it('counts each staff and voice of a bar on its own, from zero', () => {
    expect(fileKeys([[[2], [[1, false, [[1, 1], [1, 1], [2, 5], [1, 1]]]]]])).toEqual([
      'm0:0:0:0',
      'm0:0:0:1',
      'm0:1:4:0',
      'm0:0:0:2',
    ])
  })

  it('runs the count on through a bar written as two measures', () => {
    expect(fileKeys([[[], [[1, false, [[1, 1]]], [1, true, [[1, 1]]], [2, false, [[1, 1]]]]]])).toEqual([
      'm0:0:0:0',
      'm0:0:0:1',
      'm1:0:0:0',
    ])
  })

  // The two-part Entertainer: a grand staff written as two one-staff parts.
  it('numbers staves across the sheet, each part restarting its bars', () => {
    const measure = [1, false, [[1, 1]]]
    expect(fileKeys([[[], [measure]], [[], [measure]]])).toEqual(['m0:0:0:0', 'm0:1:0:0'])
  })

  it('makes room for the most staves a part declares', () => {
    const measure = [1, false, [[1, 1]]]
    expect(fileKeys([[[1, 2], [measure]], [[], [measure]]])).toEqual(['m0:0:0:0', 'm0:2:0:0'])
  })

  it('tells the caller the staff and voice the key counted', () => {
    const numbering = fileNumbering()
    numbering.part([2])
    numbering.measure(1, false)
    expect(numbering.note(2, 3)).toEqual({ key: 'm0:1:2:0', staff: 1, voice: 2 })
  })
})

// The mapping a score hands the migration: what each of its notes is called
// now, under the name it used to be called.
const map = (entries) => new Map(entries)

describe('migrateLegacyFingerings', () => {
  it('leaves a record already in the current scheme alone', () => {
    expect(migrateLegacyFingerings({ 'm0:0:0:0': 3 }, map([]))).toBeNull()
  })

  it('renames a key the score still answers to', () => {
    const result = migrateLegacyFingerings({ '1:0:0:2': 4 }, map([['1:0:0:2', ['m0:0:0:2']]]))
    expect(result.fingerings).toEqual({ 'm0:0:0:2': 4 })
    expect(result.added).toEqual(['m0:0:0:2'])
  })

  // The Gnossienne case. The player saw that fingering on every measure the
  // ambiguous key reached, so the migration leaves it on every one of them:
  // the score looks the same afterwards, and the copies can now be deleted one
  // by one. Picking a single winner would move the fingering to a measure the
  // player never touched.
  it('copies a key several notes answered to onto all of them', () => {
    const result = migrateLegacyFingerings(
      { '0:0:0:1': 2 },
      map([['0:0:0:1', ['m0:0:0:1', 'm1:0:0:1', 'm2:0:0:1']]]),
    )
    expect(result.fingerings).toEqual({ 'm0:0:0:1': 2, 'm1:0:0:1': 2, 'm2:0:0:1': 2 })
  })

  // "X1" on a second ending of the 1902 Entertainer: parseInt said NaN, OSMD
  // said null, so the fingering was stored under one name and looked for under
  // another and never appeared at all. There is nothing to keep.
  it('drops a key no note answers to', () => {
    const result = migrateLegacyFingerings({ 'null:0:0:3': 1, '1:0:0:0': 5 }, map([['1:0:0:0', ['m0:0:0:0']]]))
    expect(result.fingerings).toEqual({ 'm0:0:0:0': 5 })
    expect(result.added).toEqual(['m0:0:0:0'])
  })

  // Still a rewrite worth saving, though it leaves nothing to draw: the record
  // is rid of a key that could never mean anything.
  it('reports a record whose only legacy key is unclaimed as changed with nothing added', () => {
    const result = migrateLegacyFingerings({ 'NaN:0:0:3': 1 }, map([]))
    expect(result.fingerings).toEqual({})
    expect(result.added).toEqual([])
  })

  it('keeps a fingering already written under the current key', () => {
    const result = migrateLegacyFingerings(
      { '1:0:0:0': 2, 'm0:0:0:0': 4 },
      map([['1:0:0:0', ['m0:0:0:0']]]),
    )
    expect(result.fingerings).toEqual({ 'm0:0:0:0': 4 })
    expect(result.added).toEqual([])
  })

  it('is idempotent', () => {
    const legacyToCurrent = map([['1:0:0:0', ['m0:0:0:0']]])
    const once = migrateLegacyFingerings({ '1:0:0:0': 3 }, legacyToCurrent)
    expect(migrateLegacyFingerings(once.fingerings, legacyToCurrent)).toBeNull()
  })
})
