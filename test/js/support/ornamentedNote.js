// The shape expandOrnamentNotes reads a note in: one fake OSMD note carrying an
// OrnamentContainer. Shared so that the next field the extractor starts reading
// -- as note.Length.RealValue was, when delayed turns learned to hold their
// principal -- is added in one place instead of drifting between test files.
//
// By default explicit accidentals keep getOrnamentAuxiliaryNotes off the
// diatonic path (NATURAL: +2 above, -1 below), so no real pitch or key data is
// needed. Pass `accidental: ACCIDENTAL.NONE` and a `pitch` to take that path.

import { soundFrom } from '../../../public/js/noteExtraction.js'

// OSMD's AccidentalEnum, the values the extractor compares against.
export const ACCIDENTAL = { NONE: 2, NATURAL: 3 }

// OSMD's OrnamentEnum.
export const ORNAMENT = {
  TRILL: 0,
  TURN: 1,
  INVERTED_TURN: 2,
  DELAYED_TURN: 3,
  DELAYED_INVERTED_TURN: 4,
  MORDENT: 5,
  INVERTED_MORDENT: 6,
}

// `length` is the note's written value and `tiedInto` the values of the notes
// a tie it starts runs on into, in whole notes as OSMD gives them.
export function noteWithOrnament(
  ornamentType,
  { tied = false, midiNumber = 72, noteheadIndex = 0, accidental = ACCIDENTAL.NATURAL, pitch, staffIndex = 0, length = 0.5, tiedInto = [] } = {},
) {
  const note = { pitch, Length: { RealValue: length } }
  if (tiedInto.length) note.NoteTie = { Notes: [note, ...tiedInto.map((value) => ({ Length: { RealValue: value } }))] }
  return {
    midiNumber,
    timestamp: 1.5,
    staffIndex,
    isTieContinuation: tied,
    noteheadIndex,
    note,
    soundTs: soundFrom(note),
    voiceEntry: {
      OrnamentContainer: { GetOrnament: ornamentType, AccidentalAbove: accidental, AccidentalBelow: accidental },
    },
  }
}
