import { describe, it, expect, vi } from 'vitest'

// playback.js pulls in @tonejs/piano, which is loaded from a CDN in the browser and
// has no node package. Stub it so the pure timing helper can be imported under vitest.
vi.mock('@tonejs/piano', () => ({ Piano: class {} }))

const { expandOrnamentTimings, rollOffsetMs } = await import('../../public/js/playback.js')

// Build the expanded turn notes the keyboard matcher (expandOrnamentNotes) feeds to
// audio playback: all share one parent note object, the principal sits on the beat,
// and the turn proper carries _turnDelay (whole-note fraction the principal is held).
function turnNotes({ baseTs = 0, parentDuration, turnDelay, count }) {
  const parent = { Length: { RealValue: parentDuration } }
  const OFFSET = 0.00001
  return Array.from({ length: count }, (_, i) => ({
    note: parent,
    isTurnNote: true,
    _turnDelay: turnDelay,
    // Mirror the matcher: principal at baseTs, turn proper offset by turnDelay.
    timestamp: turnDelay > 0 && i > 0
      ? baseTs + turnDelay + (i - 1) * OFFSET
      : baseTs + i * OFFSET,
  }))
}

describe('expandOrnamentTimings', () => {
  it('spreads an on-beat turn evenly over the full note', () => {
    const result = expandOrnamentTimings(turnNotes({ parentDuration: 0.25, turnDelay: 0, count: 4 }))
    expect(result.map((n) => n.timestamp)).toEqual([0, 0.0625, 0.125, 0.1875])
    expect(result.every((n) => n._ornamentDuration === 0.0625)).toBe(true)
  })

  it('holds the principal then plays a delayed turn over the note\'s final stretch', () => {
    // Quarter note, turn delayed by 3/16 so the turn proper fills the last 1/16.
    const result = expandOrnamentTimings(turnNotes({ parentDuration: 0.25, turnDelay: 0.1875, count: 5 }))

    // Principal sounds on the beat, held until the turn starts.
    expect(result[0].timestamp).toBe(0)
    expect(result[0]._ornamentDuration).toBe(0.1875)

    // The four turn notes share the remaining 1/16, evenly.
    const turnDur = 0.0625 / 4
    expect(result.slice(1).every((n) => n._ornamentDuration === turnDur)).toBe(true)
    expect(result[1].timestamp).toBe(0.1875)

    // The turn ends exactly at the note's end (no overrun, no gap).
    const last = result[result.length - 1]
    expect(last.timestamp + last._ornamentDuration).toBeCloseTo(0.25, 10)
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
