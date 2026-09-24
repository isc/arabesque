import { describe, it, expect } from 'vitest'
import { trainingStep } from '../../public/js/musicxml.js'

// A passage of one measure, which is what training mode works on until the
// player picks a range — so these cases are the behaviour training has always
// had, restated in terms of the passage.
const single = (over) => trainingStep({
  next: 4, first: 3, last: 3, bounded: false, banked: 0, target: 3, clean: true, measureCount: 10, ...over,
})

// Measures 3 to 5, picked on the sheet.
const passage = (over) => trainingStep({
  next: 4, first: 3, last: 5, bounded: true, banked: 0, target: 3, clean: true, measureCount: 10, ...over,
})

describe('trainingStep — one measure', () => {
  it('starts the measure over until three clean repetitions are banked', () => {
    expect(single({ banked: 0 })).toEqual({ action: 'restart', to: 3, banked: 1 })
    expect(single({ banked: 1 })).toEqual({ action: 'restart', to: 3, banked: 2 })
  })

  it('banks nothing for a repetition a wrong note spoiled', () => {
    expect(single({ banked: 2, clean: false })).toEqual({ action: 'restart', to: 3, banked: 2 })
  })

  it('moves the work one measure down the score once the dots are full', () => {
    expect(single({ banked: 2 })).toEqual({ action: 'advance', to: 4, banked: 3 })
  })

  it('is done with the piece when there is no measure left to move to', () => {
    expect(single({ banked: 2, next: 10 })).toEqual({ action: 'scoreDone', banked: 3 })
  })
})

describe('trainingStep — a picked passage', () => {
  it('runs on into the next measure without touching the dots', () => {
    expect(passage({ banked: 1, next: 4 })).toEqual({ action: 'step', to: 4, banked: 1 })
  })

  it('carries a spoiled repetition across the measures it has left', () => {
    expect(passage({ banked: 1, next: 5, clean: false })).toEqual({ action: 'step', to: 5, banked: 1 })
  })

  it('banks the traversal and starts the passage over at its first measure', () => {
    expect(passage({ banked: 0, next: 6 })).toEqual({ action: 'restart', to: 3, banked: 1 })
  })

  it('is done — and stays on the passage — after three clean traversals', () => {
    expect(passage({ banked: 2, next: 6 })).toEqual({ action: 'passageDone', to: 3, banked: 3 })
  })

  it('does not run on down the score the way an unpicked measure does', () => {
    expect(passage({ banked: 2, next: 6, measureCount: 10 }).action).toBe('passageDone')
    expect(single({ banked: 2, next: 6, measureCount: 10 }).action).toBe('advance')
  })
})
