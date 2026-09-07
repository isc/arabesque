import { describe, it, expect } from 'vitest'
import { expandOrnamentNotes, isRequiredInput } from '../../public/js/noteExtraction.js'
import { ORNAMENT, noteWithOrnament } from './support/ornamentedNote.js'

// A score writes an ornament as one note and leaves its realization to the
// player. The expansion the app plays it back with is therefore a proposal, not
// a demand: exactly one of its notes -- the principal, the notated pitch on the
// beat -- stands for the ornament when the player is asked to strike something.

const PRINCIPAL = 72
const NOTEHEAD = 2

// Where the principal sits in each expansion: the sequence closes on it, except
// a delayed turn, which opens on it and holds it.
const ORNAMENTS = [
  ['a mordent', ORNAMENT.MORDENT, 2],
  ['a trill', ORNAMENT.TRILL, 2],
  ['an on-beat turn', ORNAMENT.TURN, 3],
  ['a delayed turn', ORNAMENT.DELAYED_TURN, 0],
]

const expand = (ornamentType) =>
  expandOrnamentNotes([noteWithOrnament(ornamentType, { midiNumber: PRINCIPAL, noteheadIndex: NOTEHEAD })])

describe('the principal of an expanded ornament', () => {
  it.each(ORNAMENTS)('is the notated pitch of %s, once, on the beat', (_label, ornamentType, expectedIndex) => {
    const notes = expand(ornamentType).filter((n) => !n.isTrillEnd)

    const principals = notes.filter((n) => n.isOrnamentPrincipal)
    expect(principals).toHaveLength(1)
    expect(notes.indexOf(principals[0])).toBe(expectedIndex)
    expect(principals[0].midiNumber).toBe(PRINCIPAL)
    // Within a rounding error of the beat: the expansion offsets are hundredths
    // of a millisecond, kept only to order the notes.
    expect(principals[0].timestamp).toBeCloseTo(1.5, 3)
  })

  it.each(ORNAMENTS)('is the one note %s asks the player for, and the one that carries the engraved notehead', (_label, ornamentType) => {
    const notes = expand(ornamentType)

    expect(notes.filter(isRequiredInput)).toEqual(notes.filter((n) => n.isOrnamentPrincipal))
    for (const note of notes) {
      expect(note.noteheadIndex).toBe(note.isOrnamentPrincipal ? NOTEHEAD : -1)
    }
  })
})

describe('isRequiredInput', () => {
  it('asks for a plain note', () => {
    expect(isRequiredInput({ midiNumber: 60 })).toBe(true)
  })

  it('never asks for a grace note', () => {
    expect(isRequiredInput({ midiNumber: 60, isGrace: true })).toBe(false)
  })

  it('never asks for the trill sentinel', () => {
    const sentinel = expand(ORNAMENT.TRILL).find((n) => n.isTrillEnd)
    expect(isRequiredInput(sentinel)).toBe(false)
  })
})
