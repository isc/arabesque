import { describe, it, expect } from 'vitest'
import { nextPlayableMeasure } from '../../public/js/noteExtraction.js'

// Staff 0 is the right hand, staff 1 the left. A bar one hand rests through
// simply carries none of that staff's notes.
const measure = (staves) => ({ notes: staves.map((staffIndex) => ({ staffIndex })) })

const BOTH = { right: true, left: true }
const RIGHT_ONLY = { right: true, left: false }

// The shape of bars 23-26 of BWV 847: 25 is a whole rest in the right hand.
const SCORE = [measure([0, 1]), measure([0, 1]), measure([1]), measure([0, 1])]

describe('nextPlayableMeasure', () => {
  it('stays put on a measure the active hands play', () => {
    expect(nextPlayableMeasure(SCORE, 1, RIGHT_ONLY)).toBe(1)
    expect(nextPlayableMeasure(SCORE, 2, BOTH)).toBe(2)
  })

  it('passes a measure the other hand holds by itself', () => {
    expect(nextPlayableMeasure(SCORE, 2, RIGHT_ONLY)).toBe(3)
  })

  it('passes a run of them in one go', () => {
    const score = [measure([0]), measure([1]), measure([1]), measure([0])]
    expect(nextPlayableMeasure(score, 1, RIGHT_ONLY)).toBe(3)
  })

  it('runs off the end when nothing is left for these hands', () => {
    const score = [measure([0]), measure([1])]
    expect(nextPlayableMeasure(score, 1, RIGHT_ONLY)).toBe(2)
  })

  it('passes an empty measure whichever hands are on', () => {
    expect(nextPlayableMeasure([measure([]), measure([0])], 0, BOTH)).toBe(1)
  })
})
