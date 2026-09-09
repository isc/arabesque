// The shape expandOrnamentNotes reads a note in: one fake OSMD note carrying an
// OrnamentContainer. Shared so that the next field the extractor starts reading
// -- as note.Length.RealValue was, when delayed turns learned to hold their
// principal -- is added in one place instead of drifting between test files.
//
// Explicit accidentals keep getOrnamentAuxiliaryNotes off the diatonic path
// (NATURAL: +2 above, -1 below), so no real pitch or key data is needed.
const NATURAL = 3

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

export function noteWithOrnament(ornamentType, { tied = false, midiNumber = 72, noteheadIndex = 0 } = {}) {
  return {
    midiNumber,
    timestamp: 1.5,
    measureIndex: 1,
    isTieContinuation: tied,
    noteheadIndex,
    note: { Length: { RealValue: 0.5 } },
    voiceEntry: {
      OrnamentContainer: { GetOrnament: ornamentType, AccidentalAbove: NATURAL, AccidentalBelow: NATURAL },
    },
  }
}
