import { describe, it, expect } from 'vitest'
import { expandOrnamentNotes } from '../../public/js/noteExtraction.js'
import { ORNAMENT, noteWithOrnament } from './support/ornamentedNote.js'

// An ornament re-articulates, so its expanded notes must NOT inherit the parent
// note's tie-continuation flag -- doing so suppressed their note-on in audio
// playback (which skips note-ons for tie continuations) and dropped them from
// the strict matcher, silencing the whole gruppetto on a tied note (the symptom
// on the tied turns in Beethoven's Pathétique 2nd movement). The sole exception
// is the held principal of a delayed turn: when the parent is tied into, that
// pitch is already sounding and must not be re-struck.

describe('expandOrnamentNotes tie handling', () => {
  it('does not let a delayed turn on a tied note inherit the tie on its turn proper', () => {
    const expanded = expandOrnamentNotes([noteWithOrnament(ORNAMENT.DELAYED_TURN, { tied: true })])
    // [principal, upper, principal, lower, principal]
    expect(expanded).toHaveLength(5)
    expect(expanded.every((n) => n.isTurnNote)).toBe(true)
    // Held principal keeps the tie (already sounding); the turn proper must attack.
    expect(expanded.map((n) => n.isTieContinuation)).toEqual([true, false, false, false, false])
  })

  it('marks every expanded note as a fresh attack when the parent is not tied', () => {
    const expanded = expandOrnamentNotes([noteWithOrnament(ORNAMENT.DELAYED_TURN, { tied: false })])
    expect(expanded.map((n) => n.isTieContinuation)).toEqual([false, false, false, false, false])
  })

  it('never keeps the tie for a non-delayed turn (no held principal)', () => {
    // A plain turn leads with the upper neighbour, so even index 0 is an attack.
    const expanded = expandOrnamentNotes([noteWithOrnament(ORNAMENT.TURN, { tied: true })])
    expect(expanded).toHaveLength(4)
    expect(expanded.every((n) => n.isTieContinuation === false)).toBe(true)
  })
})
