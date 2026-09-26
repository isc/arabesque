import { describe, it, expect } from 'vitest'
import { stripPlaybackTempoMarks } from '../../public/js/tempoMarks.js'

// Stands in for OSMD's SourceMeasure: one MultiTempoExpression per point in the
// measure, each holding the entries written there.
const measure = (...marks) => ({
  TempoExpressions: marks.map((labels) => ({ EntriesList: labels.map((label) => ({ label })) })),
})

const labelsOf = (sourceMeasure) =>
  sourceMeasure.TempoExpressions.map((mark) => mark.EntriesList.map((entry) => entry.label))

describe('stripPlaybackTempoMarks', () => {
  it('drops the marks whose text is nothing but a number, in OSMD\'s own array', () => {
    const measures = [measure(['112'], ['stringendo'], ['97.5'])]
    const marks = measures[0].TempoExpressions

    stripPlaybackTempoMarks(measures)

    expect(labelsOf(measures[0])).toEqual([['stringendo']])
    expect(measures[0].TempoExpressions).toBe(marks)
  })

  it('keeps the markings a pianist reads, numbers in them included', () => {
    const measures = [measure(['Andantino con moto'], ['rit.'], ['♩ = 120'])]
    stripPlaybackTempoMarks(measures)
    expect(labelsOf(measures[0])).toEqual([['Andantino con moto'], ['rit.'], ['♩ = 120']])
  })

  it('keeps a mark where a number shares the spot with a real marking', () => {
    const measures = [measure(['a tempo', '120'])]
    stripPlaybackTempoMarks(measures)
    expect(labelsOf(measures[0])).toEqual([['a tempo', '120']])
  })

  it('copes with the measures that carry no tempo mark at all', () => {
    expect(() => stripPlaybackTempoMarks([measure(), measure()])).not.toThrow()
  })
})
