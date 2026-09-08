import { describe, it, expect } from 'vitest'
import { expandOrnamentNotes, requiredSequence } from '../../public/js/noteExtraction.js'
import { ORNAMENT, noteWithOrnament } from './support/ornamentedNote.js'

// A score writes an ornament as one note and sounds it as several, and the
// notation determines that realization: a mordent is principal, lower
// neighbour, principal, the neighbour fixed by the key and by any accidental on
// the sign. So the expansion is not a proposal — it is what the player is asked
// for, in that order. One note of it stands for the whole: the principal, the
// notated pitch on the beat, which carries the engraved notehead and the
// sequence the others spell out.

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

const expand = (ornamentType, options) =>
  expandOrnamentNotes([noteWithOrnament(ornamentType, { midiNumber: PRINCIPAL, noteheadIndex: NOTEHEAD, ...options })])

const principalOf = (notes) => notes.find((n) => n.ornamentSequence)

describe('the principal of an expanded ornament', () => {
  it.each(ORNAMENTS)('is the notated pitch of %s, once, on the beat', (_label, ornamentType, expectedIndex) => {
    const notes = expand(ornamentType).filter((n) => !n.isTrillEnd)

    const principals = notes.filter((n) => n.ornamentSequence)
    expect(principals).toHaveLength(1)
    expect(notes.indexOf(principals[0])).toBe(expectedIndex)
    expect(principals[0].midiNumber).toBe(PRINCIPAL)
    // Within a rounding error of the beat: the expansion offsets are hundredths
    // of a millisecond, kept only to order the notes.
    expect(principals[0].timestamp).toBeCloseTo(1.5, 3)
  })

  it.each(ORNAMENTS)('carries the pitches %s sounds, in order, and the engraved notehead', (_label, ornamentType) => {
    const notes = expand(ornamentType)
    const sounded = notes.filter((n) => !n.isTrillEnd).map((n) => n.midiNumber)

    expect(principalOf(notes).ornamentSequence).toEqual(sounded)
    for (const note of notes) {
      expect(note.noteheadIndex).toBe(note.ornamentSequence ? NOTEHEAD : -1)
    }
  })
})

describe('requiredSequence', () => {
  it('asks for a written note by its own pitch', () => {
    expect(requiredSequence({ midiNumber: 60 }))
      .toEqual({ sequence: [60], delayTs: 0, holdTs: 0, alternating: false })
  })

  it('asks for nothing from a grace note: it leans on the beat, it is not on it', () => {
    expect(requiredSequence({ midiNumber: 60, isGrace: true }).sequence).toEqual([])
  })

  it('asks for the whole realization on the principal, and for nothing on the rest', () => {
    // A mordent on C5: principal, lower neighbour, principal.
    const notes = expand(ORNAMENT.MORDENT)
    // Half note, closed sequence: the mordent has that value to be played in.
    expect(requiredSequence(principalOf(notes)))
      .toEqual({ sequence: [72, 71, 72], delayTs: 0, holdTs: 0.5, alternating: false })
    for (const note of notes.filter((n) => !n.ornamentSequence)) {
      expect(requiredSequence(note).sequence).toEqual([])
    }
  })

  it('asks for nothing from the trill sentinel, which stands for no pitch', () => {
    const sentinel = expand(ORNAMENT.TRILL).find((n) => n.isTrillEnd)
    expect(requiredSequence(sentinel).sequence).toEqual([])
  })

  // The one thing notation leaves free: a trill may go on alternating for the
  // written value of the note it is on.
  it('lets a trill alternate, and nothing else', () => {
    expect(requiredSequence(principalOf(expand(ORNAMENT.TRILL))).alternating).toBe(true)
    expect(requiredSequence(principalOf(expand(ORNAMENT.TURN))).alternating).toBe(false)
  })

  it('asks for nothing from a pitch a tie is already holding', () => {
    expect(requiredSequence({ midiNumber: 60, isTieContinuation: true }).sequence).toEqual([])
  })

  // A delayed turn tied into: the principal is already sounding and must not be
  // re-struck, but the turn proper is still to play -- and it falls due when
  // the held principal gives way to it, not on the beat.
  it('drops from a tied delayed turn only what the tie holds', () => {
    const principal = principalOf(expand(ORNAMENT.DELAYED_TURN, { tied: true }))
    // Half note, turn proper in the final sixteenth: 1/2 - 1/16.
    expect(requiredSequence(principal))
      .toEqual({ sequence: [74, 72, 71, 72], delayTs: 0.4375, holdTs: 0.5, alternating: false })
  })
})
