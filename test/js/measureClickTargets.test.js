import { describe, it, expect } from 'vitest'
import { firstPassMeasureIndexes, firstPassIndexOf } from '../../public/js/noteExtraction.js'

// allNotes as the extraction builds it: one entry per playback position, so a
// repeated section appears once per pass, every pass pointing at the same
// engraved (source) measure.
const measure = (sourceMeasureIndex, noteCount = 1) => ({
  sourceMeasureIndex,
  notes: Array.from({ length: noteCount }, () => ({})),
})

describe('firstPassMeasureIndexes', () => {
  it('gives every measure of a score without repeats its own rect', () => {
    expect(firstPassMeasureIndexes([measure(0), measure(1), measure(2)])).toEqual([0, 1, 2])
  })

  it('draws a repeated measure once, on its first pass', () => {
    // A Hanon exercise: four bars played twice.
    const allNotes = [0, 1, 2, 3, 0, 1, 2, 3].map((s) => measure(s))
    expect(firstPassMeasureIndexes(allNotes)).toEqual([0, 1, 2, 3])
  })

  it('keeps a volta ending, which only ever plays once', () => {
    // |: 0 1 :| with a first ending (2) and a second (3).
    const allNotes = [measure(0), measure(1), measure(2), measure(0), measure(1), measure(3)]
    expect(firstPassMeasureIndexes(allNotes)).toEqual([0, 1, 2, 5])
  })

  it('skips a measure with no notes', () => {
    expect(firstPassMeasureIndexes([measure(0), measure(1, 0), measure(2)])).toEqual([0, 2])
  })
})

describe('firstPassIndexOf', () => {
  it('finds where a source measure is first played', () => {
    const allNotes = [0, 1, 2, 3, 0, 1, 2, 3].map((s) => measure(s))
    expect(firstPassIndexOf(allNotes, 2)).toBe(2)
  })

  it('reports a source measure the score never plays', () => {
    expect(firstPassIndexOf([measure(0), measure(1)], 7)).toBe(-1)
  })
})
