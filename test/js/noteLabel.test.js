import { describe, it, expect } from 'vitest'
import { noteLabel, wrongKeyNames } from '../../public/js/noteExtraction.js'

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

// The suite runs in English (support/setup.js), so these are the C-D-E
// letters. The French do-ré-mi half of the same table is exercised in the
// browser, where the app runs in French — see test/fingering_annotation_test.rb.
describe('noteLabel', () => {
  it('names a plain note with its octave', () => {
    expect(noteLabel(noteData(0, NONE, 60))).toBe('C4 · RH')
  })

  it('carries the accidental the score is written with', () => {
    expect(noteLabel(noteData(7, SHARP, 80))).toBe('G♯5 · RH')
  })

  // The point of reading the written spelling rather than the MIDI number: this
  // note is 58 either way, but the staff says si bémol, not la dièse.
  it('spells a flat as a flat', () => {
    expect(noteLabel(noteData(11, FLAT, 58))).toBe('B♭3 · RH')
  })

  // A natural sign says "not the sharp you saw earlier", which the staff has
  // already said; the name of the note is the plain letter.
  it('leaves a natural unmarked', () => {
    expect(noteLabel(noteData(4, NATURAL, 64))).toBe('E4 · RH')
  })

  // The staff the note is written on is the hand that plays it: staff 1 and
  // below are the bass clef, which is the left hand.
  it('names the hand the note is written for', () => {
    expect(noteLabel(noteData(0, NONE, 48, 1))).toBe('C3 · LH')
  })

  it('names nothing when the note has no pitch', () => {
    expect(noteLabel({ midiNumber: 60, staffIndex: 0 })).toBe('')
  })
})

// The key played for a note, named against it, as the band's verdict says a
// wrong note (attemptVerdict.js).
describe('wrongKeyNames', () => {
  // The slip that is learnt: the accidental forgotten. The same letter, so it
  // reads as that, not as a G♯ the staff never writes.
  it('names the letter owed without its accidental as a natural', () => {
    expect(wrongKeyNames(noteData(9, FLAT, 68), 69)).toEqual({ expected: 'A♭', played: 'A♮' })
  })

  it('names the letter owed with the accidental it was given', () => {
    expect(wrongKeyNames(noteData(4, NONE, 64), 63)).toEqual({ expected: 'E', played: 'E♭' })
    expect(wrongKeyNames(noteData(5, NONE, 65), 66)).toEqual({ expected: 'F', played: 'F♯' })
  })

  // A white key a semitone off is another letter, not B♯.
  it('names a white key by its own letter', () => {
    expect(wrongKeyNames(noteData(11, NONE, 71), 72)).toEqual({ expected: 'B', played: 'C' })
  })

  it('names any other black key the way it is usually written', () => {
    expect(wrongKeyNames(noteData(4, FLAT, 63), 66).played).toBe('F♯')
    expect(wrongKeyNames(noteData(2, NONE, 62), 70).played).toBe('B♭')
    expect(wrongKeyNames(noteData(9, FLAT, 68), 80).played).toBe('A♭5')
    expect(wrongKeyNames(noteData(7, NONE, 67), 68).played).toBe('G♯')
  })

  it('gives both their octave an octave apart or more', () => {
    expect(wrongKeyNames(noteData(0, NONE, 60), 72)).toEqual({ expected: 'C4', played: 'C5' })
  })
})
