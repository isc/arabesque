import { describe, it, expect } from 'vitest'
import { attemptVerdict } from '../../public/js/attemptVerdict.js'

// The suite runs in English (support/setup.js). Bars are indices: bar 9 is 8.
const wrong = (bar, hand) => ({ kind: 'wrong', bar, hand })
const hole = (bar, beat, lostMs) => ({ kind: 'hole', bar, beat, lostMs })

describe('attemptVerdict', () => {
  // Where, not what: the note is red on the score, and the line has to be
  // read from the bench (feedback b758ae14).
  it('places a wrong note by its bar and hand', () => {
    expect(attemptVerdict({ clean: false, faults: [wrong(8, 'left')] })).toEqual({
      clean: false,
      headline: '1 wrong note',
      detail: 'Bar 9 LH',
    })
  })

  it('gives a hole its beat and the time it cost', () => {
    expect(attemptVerdict({ clean: false, faults: [hole(2, 2, 1430)] }).detail).toBe('Bar 3 b. 2: stopped 1.4 s')
  })

  // The headline counts every kind; the line under it is about the one to fix
  // first, a wrong note ahead of a hole whatever came first.
  it('counts each kind and places the one to fix first', () => {
    const verdict = attemptVerdict({ clean: false, faults: [hole(0, 1, 900), wrong(1, 'right')] })
    expect(verdict.headline).toBe('1 wrong note · 1 hole')
    expect(verdict.detail).toBe('Bar 2 RH')
  })

  it('lists the bars a kind fell in, each once, with what in it', () => {
    const verdict = attemptVerdict({ clean: false, faults: [hole(8, 1, 900), hole(8, 3, 1600), hole(9, 2, 500)] })
    expect(verdict.headline).toBe('3 holes')
    expect(verdict.detail).toBe('Bar 9 b. 1 and 3, bar 10 b. 2: up to 1.6 s')
  })

  it('names both hands of a bar that both slipped in', () => {
    expect(attemptVerdict({ clean: false, faults: [{ kind: 'missed', bar: 4, hand: 'right' }, { kind: 'missed', bar: 4, hand: 'left' }] }).detail)
      .toBe('Bar 5 RH and LH')
  })

  it('counts the bars past the first few rather than naming them all', () => {
    const missed = [0, 1, 2, 3, 4].map((bar) => ({ kind: 'missed', bar, hand: 'right' }))
    expect(attemptVerdict({ clean: false, faults: missed }).detail).toBe('Bar 1 RH, bar 2 RH, bar 3 RH and 2 more')
  })

  // A strict run is clean with a note or two off the click: said under
  // "Clean", so that it is not read as perfect.
  it('says what a clean go still let through', () => {
    expect(attemptVerdict({ clean: true, faults: [{ kind: 'late', bar: 0, hand: 'left' }] })).toEqual({
      clean: true,
      headline: 'Clean',
      detail: '1 late note',
    })
    expect(attemptVerdict({ clean: true, faults: [] }).detail).toBe('')
  })

  // A wrong key struck in a rest is counted by the run without a note to put
  // it against: its bar is all there is to say.
  it('places a wrong note it cannot name', () => {
    expect(attemptVerdict({ clean: false, faults: [{ kind: 'wrong', bar: 3 }] }).detail).toBe('Bar 4')
  })

  // Struck in the count-in, before any bar: the run counts it all the same.
  it('says a wrong key in the count-in was there', () => {
    expect(attemptVerdict({ clean: false, faults: [{ kind: 'wrong', bar: null }] }).detail).toBe('In the count-in')
  })

  it('still has a headline for a go spoiled with nothing to show for it', () => {
    expect(attemptVerdict({ clean: false, faults: [] }).headline).toBe('Go again')
  })
})
