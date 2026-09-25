import { describe, it, expect } from 'vitest'
import { adjustGraceNoteTimestamps } from '../../public/js/noteExtraction.js'

// A grace note of the extraction, as far as the timing goes: OSMD gives it the
// timestamp of the note it belongs to.
const grace = (midiNumber, timestamp, isAfterGrace = false) => ({ midiNumber, timestamp, isGrace: true, isAfterGrace })
const note = (midiNumber, timestamp) => ({ midiNumber, timestamp, isGrace: false })

// The notes in the order the matcher asks for them.
const played = (notes) => [...notes].sort((a, b) => a.timestamp - b.timestamp).map((n) => n.midiNumber)

describe('adjustGraceNoteTimestamps', () => {
  it('puts grace notes before the note they lead into, in order', () => {
    const notes = [grace(62, 0.5), grace(64, 0.5), note(60, 0.5), note(59, 0)]
    adjustGraceNoteTimestamps(notes)
    expect(played(notes)).toEqual([59, 62, 64, 60])
  })

  // The cadenza of Chopin's Op. 9 No. 2: the grace notes a measure ends on
  // follow the fermata chord OSMD files them under.
  it('puts the grace notes a measure ends on after the note they follow, in order', () => {
    const notes = [note(70, 0.75), note(59, 0), grace(95, 0.75, true), grace(94, 0.75, true), grace(96, 0.75, true)]
    adjustGraceNoteTimestamps(notes)
    expect(played(notes)).toEqual([59, 70, 95, 94, 96])
  })

  it('keeps apart the grace notes before and after the same note', () => {
    const notes = [grace(62, 0.5), note(60, 0.5), grace(64, 0.5, true)]
    adjustGraceNoteTimestamps(notes)
    expect(played(notes)).toEqual([62, 60, 64])
  })
})
