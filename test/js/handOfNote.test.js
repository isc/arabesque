import { describe, it, expect } from 'vitest'
import { handOfNote } from '../../public/js/noteExtraction.js'

// innerStaff: the note's staff is neither the top nor the bottom one of its
// part. stemUp: its <stem> points up.
describe('handOfNote', () => {
  it('gives the top staff to the right hand and the one below to the left', () => {
    expect(handOfNote({ staffIndex: 0, innerStaff: false, stemUp: false })).toBe('right')
    expect(handOfNote({ staffIndex: 1, innerStaff: false, stemUp: false })).toBe('left')
  })

  // An upper voice on the bass staff has its stems up too; the staff still says.
  it('leaves the stem out of it on the bottom staff', () => {
    expect(handOfNote({ staffIndex: 1, innerStaff: false, stemUp: true })).toBe('left')
  })

  // Liszt's Ave Maria: the melody on a middle staff, stems up for the right
  // hand's thumb, down (or none) for the left's.
  it('lets the stem say the hand on a middle staff', () => {
    expect(handOfNote({ staffIndex: 1, innerStaff: true, stemUp: true })).toBe('right')
    expect(handOfNote({ staffIndex: 1, innerStaff: true, stemUp: false })).toBe('left')
  })
})
