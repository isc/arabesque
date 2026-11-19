import { describe, it, expect } from 'vitest'
import { placeChordFingerings, PLACEMENT } from '../../public/js/chordFingerings.js'

const { ABOVE, BELOW, NOT_YET_DEFINED } = PLACEMENT

// Stands in for OSMD's source model: a piano's two staves, and one staff entry
// on `staff` holding a chord of [halfTone, fingerings, placement] notes, the
// fingerings a digit, or several for the whole chord written on one note.
const piano = { Staves: [] }
piano.Staves.push({ ParentInstrument: piano }, { ParentInstrument: piano })

function chord(staff, ...notes) {
  const voiceEntry = { IsGrace: false, Notes: [], TechnicalInstructions: [] }
  for (const [halfTone, values = [], placement = NOT_YET_DEFINED] of notes) {
    const note = { Pitch: { getHalfTone: () => halfTone } }
    voiceEntry.Notes.push(note)
    for (const value of [values].flat()) {
      voiceEntry.TechnicalInstructions.push({ type: 0, value, placement, sourceNote: note })
    }
  }
  const staffEntry = { ParentStaff: piano.Staves[staff], VoiceEntries: [voiceEntry] }
  return { measures: [{ VerticalSourceStaffEntryContainers: [{ StaffEntries: [staffEntry] }] }], voiceEntry }
}

function placed(staff, ...notes) {
  const { measures, voiceEntry } = chord(staff, ...notes)
  placeChordFingerings(measures)
  return voiceEntry.TechnicalInstructions.map((fingering) => fingering.placement)
}

describe('placeChordFingerings', () => {
  it('puts a right-hand fingering under the staff while the top note of its chord has none', () => {
    expect(placed(0, [52, '2'], [55])).toEqual([BELOW])
  })

  it('puts a left-hand fingering over the staff while the bottom note of its chord has none', () => {
    expect(placed(1, [40], [45], [48, '1'])).toEqual([ABOVE])
  })

  it('leaves the fingerings of a chord whose outer note has one where OSMD puts them', () => {
    expect(placed(0, [52, '2'], [55, '4'])).toEqual([NOT_YET_DEFINED, NOT_YET_DEFINED])
  })

  it('puts a fingering it moved back once the outer note has one', () => {
    const { measures, voiceEntry } = chord(0, [52, '2'], [55])
    placeChordFingerings(measures)
    voiceEntry.TechnicalInstructions.push({ type: 0, value: '4', sourceNote: voiceEntry.Notes[1] })

    placeChordFingerings(measures)

    expect(voiceEntry.TechnicalInstructions.map((fingering) => fingering.placement)).toEqual([
      NOT_YET_DEFINED,
      NOT_YET_DEFINED,
    ])
  })

  it('leaves a placement the file wrote', () => {
    expect(placed(0, [52, '2', ABOVE], [55])).toEqual([ABOVE])
  })

  it('leaves a whole chord fingered from one of its notes, as lines of one fingering', () => {
    expect(placed(1, [43], [46], [49], [51, '1\n2\n3\n5'])).toEqual([NOT_YET_DEFINED])
  })

  it('leaves a whole chord fingered from one of its notes, as several fingerings', () => {
    expect(placed(0, [52, ['1', '5']], [55], [60])).toEqual([NOT_YET_DEFINED, NOT_YET_DEFINED])
  })
})
