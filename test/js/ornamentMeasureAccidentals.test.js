import { describe, it, expect } from 'vitest'
import { expandOrnamentNotes } from '../../public/js/noteExtraction.js'
import { ACCIDENTAL, ORNAMENT, noteWithOrnament } from './support/ornamentedNote.js'

// An accidental holds to the end of its measure, on its line or space, and an
// ornament's neighbour is a note like any other. Bach's C minor prelude, bar
// 34: an E natural, then a mordent on F -- the mordent dips to E natural, not
// to the E flat of the key.

const C_MINOR = -3
const F4 = 65
const E_FLAT_4 = 63
const E_NATURAL_4 = 64
// OSMD's fundamentalNote: the letter's semitone offset from C.
const LETTER = { E: 4, F: 5 }

const written = (midiNumber, letter, { timestamp = 1.25, staffIndex = 0, tied = false } = {}) => ({
  midiNumber,
  timestamp,
  staffIndex,
  isTieContinuation: tied,
  note: { pitch: { fundamentalNote: LETTER[letter], halfTone: midiNumber - 12 } },
})

const mordentOnF = noteWithOrnament(ORNAMENT.MORDENT, {
  midiNumber: F4,
  pitch: written(F4, 'F').note.pitch,
  accidental: ACCIDENTAL.NONE,
})

const mordentAfter = (...earlier) =>
  expandOrnamentNotes([...earlier, mordentOnF], C_MINOR)
    .filter((n) => n.isMordentNote)
    .map((n) => n.midiNumber)

describe('an ornament after an accidental in the same measure', () => {
  it('reaches for the key’s neighbour when nothing altered it', () => {
    expect(mordentAfter()).toEqual([F4, E_FLAT_4, F4])
  })

  it('takes the accidental written earlier on the same line', () => {
    expect(mordentAfter(written(E_NATURAL_4, 'E'))).toEqual([F4, E_NATURAL_4, F4])
  })

  it('follows the latest of several', () => {
    expect(mordentAfter(written(E_NATURAL_4, 'E', { timestamp: 1 }), written(E_FLAT_4, 'E'))).toEqual([F4, E_FLAT_4, F4])
  })

  it('ignores the other staff, another octave and a note tied in from the measure before', () => {
    expect(mordentAfter(
      written(E_NATURAL_4, 'E', { staffIndex: 1 }),
      written(E_NATURAL_4 + 12, 'E'),
      written(E_NATURAL_4, 'E', { tied: true }),
    )).toEqual([F4, E_FLAT_4, F4])
  })
})
