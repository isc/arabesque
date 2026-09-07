import { describe, it, expect } from 'vitest'
import { noteLabel } from '../../public/js/noteExtraction.js'

// A noteData as noteLabel reads it: the source note's pitch as OSMD spells it
// (the letter as its semitone offset from C, the accidental as its enum value),
// plus the MIDI number the extraction already put beside it. OSMD's own
// Pitch.octave is deliberately absent — it counts three octaves lower than the
// name anyone reads, so the label must be taking the octave from the MIDI number.
const noteData = (fundamentalNote, accidental, midiNumber, staffIndex = 0) => ({
  note: { pitch: { fundamentalNote, accidental } },
  midiNumber,
  staffIndex,
})

const SHARP = 0
const FLAT = 1
const NONE = 2
const NATURAL = 3

// The node test environment has no navigator.language, so i18n falls back to
// English and these are the C-D-E letters. The French do-ré-mi half of the same
// table is exercised in the browser, where the app runs in French — see
// test/fingering_annotation_test.rb.
describe('noteLabel', () => {
  it('names a plain note with its octave', () => {
    expect(noteLabel(noteData(0, NONE, 60))).toBe('C4 · right hand')
  })

  it('carries the accidental the score is written with', () => {
    expect(noteLabel(noteData(7, SHARP, 80))).toBe('G♯5 · right hand')
  })

  // The point of reading the written spelling rather than the MIDI number: this
  // note is 58 either way, but the staff says si bémol, not la dièse.
  it('spells a flat as a flat', () => {
    expect(noteLabel(noteData(11, FLAT, 58))).toBe('B♭3 · right hand')
  })

  // A natural sign says "not the sharp you saw earlier", which the staff has
  // already said; the name of the note is the plain letter.
  it('leaves a natural unmarked', () => {
    expect(noteLabel(noteData(4, NATURAL, 64))).toBe('E4 · right hand')
  })

  // The staff the note is written on is the hand that plays it: staff 1 and
  // below are the bass clef, which is the left hand.
  it('names the hand the note is written for', () => {
    expect(noteLabel(noteData(0, NONE, 48, 1))).toBe('C3 · left hand')
  })

  it('names nothing when the note has no pitch', () => {
    expect(noteLabel({ midiNumber: 60, staffIndex: 0 })).toBe('')
  })
})
