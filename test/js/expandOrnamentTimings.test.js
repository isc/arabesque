import { describe, it, expect, vi } from 'vitest'
import { expandOrnamentNotes } from '../../public/js/noteExtraction.js'
import { noteWithOrnament, ORNAMENT } from './support/ornamentedNote.js'

// playback.js pulls in @tonejs/piano, which is loaded from a CDN in the browser and
// has no node package. Stub it so the pure timing helper can be imported under vitest.
vi.mock('@tonejs/piano', () => ({ Piano: class {} }))

const { expandOrnamentTimings, rollOffsetMs } = await import('../../public/js/playback.js')

// What audio playback is handed for one ornamented note — the extractor's own
// expansion — timed.
function realized(ornament, options) {
  return expandOrnamentTimings(expandOrnamentNotes([noteWithOrnament(ornament, options)]))
}

// When each note sounds and for how long, from the note's beat (noteWithOrnament
// puts it at 1.5), in whole notes.
const timed = (ornament, options) => realized(ornament, options).map((n) => [n.timestamp - 1.5, n._ornamentDuration])

describe('expandOrnamentTimings', () => {
  it('spreads an on-beat turn evenly over the full note', () => {
    expect(timed(ORNAMENT.TURN, { length: 0.25 })).toEqual([[0, 0.0625], [0.0625, 0.0625], [0.125, 0.0625], [0.1875, 0.0625]])
  })

  // A quarter note: the principal is held 3/16 on the beat, and the turn
  // proper fills the last 1/16, ending exactly at the note's end.
  it('holds the principal then plays a delayed turn over the note\'s final stretch', () => {
    const turn = 0.0625 / 4
    expect(timed(ORNAMENT.DELAYED_TURN, { length: 0.25 })).toEqual([
      [0, 0.1875], [0.1875, turn], [0.1875 + turn, turn], [0.1875 + 2 * turn, turn], [0.1875 + 3 * turn, turn],
    ])
  })

  // A trill goes on for as long as its note sounds, at thirty-second notes,
  // and ends on the note it began with: here a whole note tied into a half,
  // over the bar line, where the tied half is only a sentinel. It used to
  // play the three notes it is written as over the first note, then nothing.
  it('trills for the whole of a note tied over the bar line', () => {
    const trill = realized(ORNAMENT.TRILL, { length: 1, tiedInto: [0.5] })
    expect(trill.map((n) => n.midiNumber)).toEqual(Array.from({ length: 49 }, (_, i) => (i % 2 ? 74 : 72)))
    const last = trill.at(-1)
    expect(last.timestamp + last._ornamentDuration).toBeCloseTo(1.5 + 1.5, 10)
  })

  it('keeps the three notes a trill is written as on a short note', () => {
    expect(realized(ORNAMENT.TRILL, { length: 0.0625 }).map((n) => n.midiNumber)).toEqual([72, 74, 72])
  })

  it('holds a mordent\'s last note to the end of the note', () => {
    expect(timed(ORNAMENT.MORDENT, { length: 0.5 })).toEqual([[0, 0.0625], [0.0625, 0.0625], [0.125, 0.375]])
  })

  it('rings a delayed turn\'s last note on through the tie', () => {
    const [at, duration] = timed(ORNAMENT.DELAYED_TURN, { length: 0.25, tiedInto: [0.5] }).at(-1)
    expect(at + duration).toBeCloseTo(0.75, 10)
  })

  it('passes non-ornament notes through untouched', () => {
    const plain = { timestamp: 1, midiNumber: 60 }
    const result = expandOrnamentTimings([plain])
    expect(result).toEqual([plain])
  })
})

// A chord note as the extractor hands it over: `arpeggio` is the OSMD Arpeggio
// the note carries when it has an <arpeggiate/> (type 3 = direction="down").
function chordNote(midiNumber, { timestamp = 0, length = 0.25, arpeggio } = {}) {
  return { midiNumber, timestamp, note: { Length: { RealValue: length }, Arpeggio: arpeggio } }
}

const rollOrder = (notes) => notes.filter((n) => n._roll).sort((a, b) => a._roll.index - b._roll.index).map((n) => n.midiNumber)

describe('arpeggiated chords', () => {
  const up = { type: 7 }
  const down = { type: 3 }

  it('rolls an arpeggiated chord from the bottom', () => {
    const result = expandOrnamentTimings([chordNote(67, { arpeggio: up }), chordNote(60, { arpeggio: up }), chordNote(64, { arpeggio: up })])
    expect(rollOrder(result)).toEqual([60, 64, 67])
    expect(result.every((n) => n._roll.steps === 2 && n._roll.shortestWn === 0.25)).toBe(true)
  })

  it('rolls from the top for direction="down"', () => {
    const result = expandOrnamentTimings([chordNote(60, { arpeggio: down }), chordNote(64, { arpeggio: down }), chordNote(67, { arpeggio: down })])
    expect(rollOrder(result)).toEqual([67, 64, 60])
  })

  it('rolls both staves as one sweep, bass first', () => {
    const rh = { type: 7 }
    const lh = { type: 7 }
    const result = expandOrnamentTimings([
      chordNote(72, { arpeggio: rh }), chordNote(76, { arpeggio: rh }),
      chordNote(48, { arpeggio: lh, length: 0.5 }), chordNote(55, { arpeggio: lh, length: 0.5 }),
    ])
    expect(rollOrder(result)).toEqual([48, 55, 72, 76])
    expect(result.every((n) => n._roll.shortestWn === 0.25)).toBe(true)
  })

  it('keeps a chord with no arpeggio sign, or a non-arpeggiate bracket, a block', () => {
    // OSMD does not turn <non-arpeggiate/> into an Arpeggio: the notes carry none.
    const result = expandOrnamentTimings([chordNote(60), chordNote(64), chordNote(67)])
    expect(result.some((n) => n._roll)).toBe(false)
  })

  it('rolls separate chords separately', () => {
    const result = expandOrnamentTimings([
      chordNote(60, { arpeggio: up }), chordNote(64, { arpeggio: up }),
      chordNote(62, { arpeggio: up, timestamp: 0.25 }), chordNote(65, { arpeggio: up, timestamp: 0.25 }),
    ])
    expect(result.map((n) => n._roll.index)).toEqual([0, 1, 0, 1])
  })

  it('does not mark the extractor\'s own note objects', () => {
    const notes = [chordNote(60, { arpeggio: up }), chordNote(64, { arpeggio: up })]
    expandOrnamentTimings(notes)
    expect(notes.some((n) => n._roll)).toBe(false)
  })

  it('leaves a tie continuation where it is', () => {
    const tied = { ...chordNote(60, { arpeggio: up }), isTieContinuation: true }
    const result = expandOrnamentTimings([tied, chordNote(64, { arpeggio: up }), chordNote(67, { arpeggio: up })])
    expect(result.find((n) => n.midiNumber === 60)._roll).toBeUndefined()
    expect(rollOrder(result)).toEqual([64, 67])
  })
})

describe('rollOffsetMs', () => {
  it('spaces the notes of a roll a fixed step apart', () => {
    // A half note at 60 BPM lasts 2s: plenty of room, so the full step.
    expect([0, 1, 2].map((index) => rollOffsetMs({ index, steps: 2, shortestWn: 0.5 }, 60))).toEqual([0, 40, 80])
  })

  it('squeezes the roll into half of a short chord', () => {
    // An eighth at 150 BPM lasts 200ms: the four steps share 100ms.
    expect(rollOffsetMs({ index: 4, steps: 4, shortestWn: 0.125 }, 150)).toBeCloseTo(100, 10)
  })
})
