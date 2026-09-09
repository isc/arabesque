import { describe, it, expect } from 'vitest'
import {
  expectedEvent,
  findMatchingEvent,
  advanceEvent,
  isGraceStrike,
  classifyMatch,
  faultAbsorbingEvent,
} from '../../public/js/strictMatching.js'

const OFFTEMPO_WINDOW = 450
const TOLERANCE = 150

// A written note: one pitch, open for the off-tempo window either side of it.
function event(timeMs, midiNumber, status = 'pending') {
  return expectedEvent({
    timeMs,
    sequence: [midiNumber],
    openUntilMs: timeMs + OFFTEMPO_WINDOW,
    status,
  })
}

// An ornamented note: the pitches of its realization, in order, with the whole
// written value of the note it decorates to be played in.
function ornament(timeMs, sequence, { heldMs = 1000, alternating = false } = {}) {
  return expectedEvent({
    timeMs,
    sequence,
    openUntilMs: timeMs + heldMs + OFFTEMPO_WINDOW,
    alternating,
  })
}

// Strike `midiNumber` at `now` and answer what the run would record: the
// classification the event settled on, or null for a note taken without
// settling anything, or 'wrong' when nothing was waiting for it.
function strike(events, midiNumber, now) {
  const match = findMatchingEvent(events, midiNumber, now, OFFTEMPO_WINDOW)
  if (!match) return 'wrong'
  return advanceEvent(match.event, match.delta, TOLERANCE)
}

describe('findMatchingEvent', () => {
  it('matches a pending event at exact time', () => {
    const events = [event(1000, 60)]
    const match = findMatchingEvent(events, 60, 1000, OFFTEMPO_WINDOW)
    expect(match).toEqual({ event: events[0], delta: 0 })
  })

  it('matches when played early within the off-tempo window', () => {
    const events = [event(1000, 60)]
    const match = findMatchingEvent(events, 60, 700, OFFTEMPO_WINDOW)
    expect(match.event).toBe(events[0])
    expect(match.delta).toBe(-300)
  })

  it('matches when played late within the off-tempo window', () => {
    const events = [event(1000, 60)]
    const match = findMatchingEvent(events, 60, 1300, OFFTEMPO_WINDOW)
    expect(match.event).toBe(events[0])
    expect(match.delta).toBe(300)
  })

  it('does not match outside the off-tempo window', () => {
    const events = [event(1000, 60)]
    expect(findMatchingEvent(events, 60, 500, OFFTEMPO_WINDOW)).toBeNull()
    expect(findMatchingEvent(events, 60, 1500, OFFTEMPO_WINDOW)).toBeNull()
  })

  it('does not match a different pitch', () => {
    const events = [event(1000, 60)]
    expect(findMatchingEvent(events, 64, 1000, OFFTEMPO_WINDOW)).toBeNull()
  })

  it('skips already-hit events and falls through to the next pending one', () => {
    const events = [event(1000, 60, 'settled'), event(1300, 60, 'pending')]
    const match = findMatchingEvent(events, 60, 1100, OFFTEMPO_WINDOW)
    expect(match.event).toBe(events[1])
    expect(match.delta).toBe(-200)
  })

  it('picks the closest pending event when several share the same pitch', () => {
    const events = [event(1000, 60), event(1500, 60)]
    // delta to e0 = +300, delta to e1 = -200 → e1 wins
    const match = findMatchingEvent(events, 60, 1300, OFFTEMPO_WINDOW)
    expect(match.event).toBe(events[1])
    expect(match.delta).toBe(-200)
  })

  it('breaks early when the next pending event is beyond the look-ahead window', () => {
    const events = [event(2000, 60)]
    // 2000 - 1000 = 1000 > 450 → no match, but also early-exit
    expect(findMatchingEvent(events, 60, 1000, OFFTEMPO_WINDOW)).toBeNull()
  })

  it('returns null when the events list is empty', () => {
    expect(findMatchingEvent([], 60, 1000, OFFTEMPO_WINDOW)).toBeNull()
  })

  it('does not match a recently-missed event', () => {
    const events = [event(1000, 60, 'missed')]
    expect(findMatchingEvent(events, 60, 1100, OFFTEMPO_WINDOW)).toBeNull()
  })
})

describe('advanceEvent on a written note', () => {
  it('settles at once, in tempo when the strike is within tolerance', () => {
    const e = event(1000, 60)
    expect(advanceEvent(e, 100, TOLERANCE)).toBe('hit')
    expect(e.status).toBe('settled')
  })

  it('settles off-tempo when the strike is past the tolerance', () => {
    const early = event(1000, 60)
    expect(advanceEvent(early, -300, TOLERANCE)).toBe('offtempoEarly')
    expect(early.status).toBe('settled')

    const late = event(1000, 60)
    expect(advanceEvent(late, 300, TOLERANCE)).toBe('offtempoLate')
    expect(late.status).toBe('settled')
  })

  it('takes nothing more once it has settled', () => {
    const events = [event(1000, 60)]
    expect(strike(events, 60, 1000)).toBe('hit')
    expect(strike(events, 60, 1050)).toBe('wrong')
  })
})

// An ornament is written as one note and realized as several, and the notation
// determines that realization: the pitches, and the order they come in. The run
// asks for the whole of it, judged by order rather than by a clock of its own —
// the ornament is anchored to its beat by the strike that opens it.
describe('advanceEvent on an ornament', () => {
  // A mordent on C5: principal, lower neighbour, principal.
  const MORDENT = [72, 71, 72]

  it('takes the realization in order and settles on its last note', () => {
    const events = [ornament(1000, MORDENT)]
    expect(strike(events, 72, 1000)).toBeNull()
    expect(strike(events, 71, 1040)).toBeNull()
    expect(strike(events, 72, 1080)).toBe('hit')
    expect(events[0].status).toBe('settled')
  })

  it('refuses the same pitches out of order', () => {
    const events = [ornament(1000, MORDENT)]
    // principal, principal, lower: every pitch of the mordent, not the mordent.
    expect(strike(events, 72, 1000)).toBeNull()
    expect(strike(events, 72, 1040)).toBe('wrong')
    // The ornament has not moved on: it is still waiting for its lower neighbour.
    expect(strike(events, 71, 1080)).toBeNull()
  })

  it('is not settled by its principal alone', () => {
    const events = [ornament(1000, MORDENT)]
    expect(strike(events, 72, 1000)).toBeNull()
    expect(events[0].status).toBe('pending')
  })

  it('keeps the verdict its first strike earned, however fast the rest comes', () => {
    // The whole ornament is late: the beat is what it is judged against, and
    // that is decided once, when it begins.
    const events = [ornament(1000, MORDENT)]
    expect(strike(events, 72, 1300)).toBeNull()
    expect(strike(events, 71, 1310)).toBeNull()
    expect(strike(events, 72, 1320)).toBe('offtempoLate')
  })

  it('goes on being playable past the off-tempo window, to the end of the note', () => {
    const events = [ornament(1000, MORDENT, { heldMs: 1000 })]
    expect(strike(events, 72, 1000)).toBeNull()
    // Well past 1000 + 450, still inside the note the mordent decorates.
    expect(strike(events, 71, 1900)).toBeNull()
    expect(strike(events, 72, 2400)).toBe('hit')
  })

  it('has to open on its beat, however long it stays open afterwards', () => {
    // The long span is for playing the ornament out, not for starting it late.
    const events = [ornament(1000, MORDENT, { heldMs: 1000 })]
    expect(strike(events, 72, 1600)).toBe('wrong')
  })

  it('takes no more once that note is over', () => {
    const events = [ornament(1000, MORDENT, { heldMs: 1000 })]
    expect(strike(events, 72, 1000)).toBeNull()
    expect(strike(events, 71, 2500)).toBe('wrong')
  })

  it('takes nothing more once its closed sequence is complete', () => {
    const events = [ornament(1000, MORDENT)]
    strike(events, 72, 1000)
    strike(events, 71, 1040)
    expect(strike(events, 72, 1080)).toBe('hit')
    // A fourth note is not part of a mordent, early in the note or not.
    expect(strike(events, 71, 1120)).toBe('wrong')
  })

  it('takes a delayed turn as it is written: principal held, then the turn proper', () => {
    // Upper, principal, lower, principal, after the principal on the beat.
    const events = [ornament(1000, [72, 74, 72, 71, 72], { heldMs: 1000 })]
    expect(strike(events, 72, 1000)).toBeNull()
    expect(strike(events, 74, 1750)).toBeNull()
    expect(strike(events, 72, 1790)).toBeNull()
    expect(strike(events, 71, 1830)).toBeNull()
    expect(strike(events, 72, 1870)).toBe('hit')
  })
})

// The one thing notation leaves to the player: how many times a trill
// alternates, and how fast. Its pitches and its opening are as written as any
// other ornament's.
describe('advanceEvent on a trill', () => {
  const TRILL = [69, 71, 69]
  const trill = (timeMs) => ornament(timeMs, TRILL, { heldMs: 1000, alternating: true })

  it('is credited on its written sequence, then goes on alternating for free', () => {
    const events = [trill(1000)]
    expect(strike(events, 69, 1000)).toBeNull()
    expect(strike(events, 71, 1040)).toBeNull()
    expect(strike(events, 69, 1080)).toBe('hit')

    // Four more alternations, none of them counted again, none of them wrong.
    for (const [midi, at] of [[71, 1120], [69, 1160], [71, 1200], [69, 1240]]) {
      expect(strike(events, midi, at)).toBeNull()
    }
    expect(events[0].status).toBe('settled')
  })

  it('alternates: the free notes are not a free bag of two pitches', () => {
    const events = [trill(1000)]
    strike(events, 69, 1000)
    strike(events, 71, 1040)
    strike(events, 69, 1080)
    expect(strike(events, 69, 1120)).toBe('wrong')
  })

  it('stops taking alternations at the end of the note it decorates', () => {
    const events = [trill(1000)]
    strike(events, 69, 1000)
    strike(events, 71, 1040)
    strike(events, 69, 1080)
    expect(strike(events, 71, 1400)).toBeNull()
    expect(strike(events, 71, 2500)).toBe('wrong')
  })

  it('takes nothing at all once it has been missed', () => {
    const events = [trill(1000)]
    events[0].status = 'missed'
    expect(strike(events, 69, 1100)).toBe('wrong')
  })
})

// What the run lets through without asking for it: grace notes. They are struck
// ahead of the beat they lean on, and how far ahead is the player's, so their
// pitch is neither a hit nor a wrong note.
describe('isGraceStrike', () => {
  // Two grace notes leaning on a beat at 1000ms.
  const graceNotes = [
    { midiNumber: 64, timeMs: 1000 },
    { midiNumber: 65, timeMs: 1000 },
  ]

  it('lets a grace pitch through around its beat', () => {
    expect(isGraceStrike(graceNotes, 64, 900, OFFTEMPO_WINDOW)).toBe(true)
    expect(isGraceStrike(graceNotes, 65, 1400, OFFTEMPO_WINDOW)).toBe(true)
  })

  it('does not let it through once the beat has gone by', () => {
    expect(isGraceStrike(graceNotes, 64, 1500, OFFTEMPO_WINDOW)).toBe(false)
  })

  it('does not let it through before the beat comes round', () => {
    expect(isGraceStrike(graceNotes, 64, 400, OFFTEMPO_WINDOW)).toBe(false)
  })

  it('does not let through a pitch no grace note carries', () => {
    expect(isGraceStrike(graceNotes, 70, 1000, OFFTEMPO_WINDOW)).toBe(false)
  })

  it('lets nothing through when the score has no grace note', () => {
    expect(isGraceStrike([], 64, 1000, OFFTEMPO_WINDOW)).toBe(false)
  })

  it('reaches a grace note later in the piece', () => {
    const later = [...graceNotes, { midiNumber: 60, timeMs: 5000 }]
    expect(isGraceStrike(later, 60, 5000, OFFTEMPO_WINDOW)).toBe(true)
  })
})

describe('classifyMatch', () => {
  it('classifies as hit when delta is within ±tolerance', () => {
    expect(classifyMatch(0, TOLERANCE)).toBe('hit')
    expect(classifyMatch(150, TOLERANCE)).toBe('hit')
    expect(classifyMatch(-150, TOLERANCE)).toBe('hit')
  })

  it('classifies negative delta beyond tolerance as offtempoEarly', () => {
    expect(classifyMatch(-151, TOLERANCE)).toBe('offtempoEarly')
    expect(classifyMatch(-300, TOLERANCE)).toBe('offtempoEarly')
  })

  it('classifies positive delta beyond tolerance as offtempoLate', () => {
    expect(classifyMatch(151, TOLERANCE)).toBe('offtempoLate')
    expect(classifyMatch(300, TOLERANCE)).toBe('offtempoLate')
  })
})

// An ornament is one written note, and must cost one fault however many notes
// it spells out — otherwise the mode scores a passage played as written below
// the same passage played plainly, which is the opposite of what it is for.
describe('what a stray strike is charged to', () => {
  const mordent = () => expectedEvent({ timeMs: 1000, sequence: [60, 59, 60], openUntilMs: 3000 })
  const plain = () => expectedEvent({ timeMs: 1000, sequence: [72], openUntilMs: 1150 })

  // The run charges the first strike the lookup claims and absorbs the rest.
  const charge = (events, midi, now) => {
    const event = faultAbsorbingEvent(events, midi, now)
    if (event?.faulted) return 'absorbed'
    if (event) event.faulted = true
    return 'wrong'
  }

  it('charges a late mordent once, not once per note of it', () => {
    const events = [mordent()]

    expect(charge(events, 60, 1500)).toBe('wrong')
    expect(charge(events, 59, 1520)).toBe('absorbed')
    expect(charge(events, 60, 1540)).toBe('absorbed')
  })

  it('charges a late plain note once, which is the same price', () => {
    const events = [plain()]

    expect(charge(events, 72, 1400)).toBe('wrong')
  })

  it('claims no pitch the ornament does not spell out', () => {
    const events = [mordent()]

    expect(faultAbsorbingEvent(events, 65, 1500)).toBeNull()
  })

  it('claims nothing once the note it decorates is over', () => {
    const events = [mordent()]

    expect(faultAbsorbingEvent(events, 59, 3001)).toBeNull()
  })

  it('leaves a plain note to answer for itself', () => {
    const events = [plain()]

    expect(faultAbsorbingEvent(events, 72, 1100)).toBeNull()
  })
})
