import { describe, it, expect } from 'vitest'
import {
  fingeringKey,
  isLegacyFingeringKey,
  legacyFingeringKey,
  migrateLegacyFingerings,
  nextNoteIndex,
  parseFingeringKey,
} from '../../public/js/fingeringKeys.js'

describe('fingering keys', () => {
  it('round-trips through parseFingeringKey', () => {
    expect(parseFingeringKey(fingeringKey(12, 1, 4, 7))).toEqual({
      measureIndex: 12,
      staff: 1,
      voice: 4,
      noteIndex: 7,
    })
  })

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
