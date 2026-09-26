import { describe, it, expect } from 'vitest'
import { carryOverNoteStates } from '../../public/js/noteExtraction.js'
import { chooseCurrentPassOccurrences } from '../../public/js/fingeringEditor.js'

// Build a minimal allNotes-like structure. Two occurrences of the same source note
// (a repeated measure) share a fingeringKey but sit at different playback indices.
function makeAllNotes(states) {
  // states: array (per playback measure) of arrays of { key, played, active }
  return states.map((measure) => ({
    notes: measure.map(({ key, played = false, active = false }) => ({
      fingeringKey: key,
      played,
      active,
    })),
  }))
}

describe('carryOverNoteStates', () => {
  it('keeps the two occurrences of a repeated note independent', () => {
    // First pass of a repeated measure was played; the repeat (second occurrence) was not.
    const outgoing = makeAllNotes([
      [{ key: 'm1n1', played: true }], // playback index 0: first pass, played
      [{ key: 'm1n1', played: false }], // playback index 1: repeat, not yet played
    ])

    // What the re-extraction after a fingering change builds: same shape, all reset.
    const rebuilt = makeAllNotes([[{ key: 'm1n1' }], [{ key: 'm1n1' }]])
    carryOverNoteStates(outgoing, rebuilt)

    expect(rebuilt[0].notes[0].played).toBe(true)
    // The repeat must NOT inherit the first pass's "played" state (the bug this fixes).
    expect(rebuilt[1].notes[0].played).toBe(false)
  })

  it('carries played and active over per playback position', () => {
    const outgoing = makeAllNotes([
      [{ key: 'a', played: true }, { key: 'b', active: true }],
      [{ key: 'a' }, { key: 'b' }],
    ])
    const rebuilt = makeAllNotes([[{ key: 'a' }, { key: 'b' }], [{ key: 'a' }, { key: 'b' }]])
    carryOverNoteStates(outgoing, rebuilt)

    expect(rebuilt[0].notes[0]).toMatchObject({ played: true, active: false })
    expect(rebuilt[0].notes[1]).toMatchObject({ played: false, active: true })
    expect(rebuilt[1].notes[0]).toMatchObject({ played: false, active: false })
  })
})

describe('chooseCurrentPassOccurrences', () => {
  // Repeated note at playback indices 0 (first pass) and 2 (repeat); a distinct note at index 1.
  const allNotes = makeAllNotes([
    [{ key: 'rep' }],
    [{ key: 'mid' }],
    [{ key: 'rep' }],
  ])

  it('picks the first-pass occurrence while in the first pass', () => {
    const chosen = chooseCurrentPassOccurrences(allNotes, 0)
    expect(chosen.get('rep')).toBe(allNotes[0].notes[0])
  })

  it('picks the repeat occurrence once the cursor is past it', () => {
    const chosen = chooseCurrentPassOccurrences(allNotes, 2)
    expect(chosen.get('rep')).toBe(allNotes[2].notes[0])
  })

  it('falls back to the earliest occurrence when none has been reached yet', () => {
    const chosen = chooseCurrentPassOccurrences(allNotes, -1)
    expect(chosen.get('rep')).toBe(allNotes[0].notes[0])
  })
})
