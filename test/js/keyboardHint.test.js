import { describe, it, expect } from 'vitest'
import {
  hintStep,
  initialHint,
  keyboardRange,
  keyLayout,
  HINT_WRONG_NOTES,
  HINT_HESITATION_MS,
  HINT_FLUENT_NOTES,
  HINT_FLUENT_MS,
} from '../../public/js/keyboardHint.js'

const run = (events, state = initialHint()) => events.reduce(hintStep, state)
const tick = (key, now, eligible = true) => ({ type: 'tick', key, now, eligible })
const press = (now) => ({ type: 'press', now })
const wrong = (now) => ({ type: 'wrong', now })

// Reaches the keyboard being up, through wrong notes on the first note.
const revealed = () =>
  run([tick('0:0', 0), ...Array.from({ length: HINT_WRONG_NOTES }, (_, i) => wrong(100 + i))])

describe('hintStep', () => {
  it('stays down while the player finds the notes', () => {
    const state = run([tick('0:0', 0), press(500), tick('0:0.25', 500), press(1500), tick('0:0.5', 1500)])
    expect(state.visible).toBe(false)
  })

  it('comes up after several wrong keys for the same note', () => {
    const almost = run([tick('0:0', 0), ...Array.from({ length: HINT_WRONG_NOTES - 1 }, (_, i) => wrong(i))])
    expect(almost.visible).toBe(false)
    expect(hintStep(almost, wrong(10)).visible).toBe(true)
  })

  it('counts wrong keys per note, not per piece', () => {
    const state = run([
      tick('0:0', 0),
      wrong(10),
      wrong(20),
      press(30),
      tick('0:0.25', 30),
      wrong(40),
      wrong(50),
    ])
    expect(state.visible).toBe(false)
  })

  it('comes up when a note is waited on too long', () => {
    const waiting = run([tick('0:0', 0), press(0), tick('0:0.25', 0)])
    expect(hintStep(waiting, tick('0:0.25', HINT_HESITATION_MS - 1)).visible).toBe(false)
    expect(hintStep(waiting, tick('0:0.25', HINT_HESITATION_MS)).visible).toBe(true)
  })

  it('does not take a score left open before the first key for hesitation', () => {
    expect(run([tick('0:0', 0), tick('0:0', HINT_HESITATION_MS * 5)]).visible).toBe(false)
    // …and the wait starts with the first key, not with the page.
    const state = run([tick('0:0', 0), wrong(HINT_HESITATION_MS * 5), tick('0:0', HINT_HESITATION_MS * 5 + 10)])
    expect(state.visible).toBe(false)
  })

  it('does not count a wait while nothing is asked of the player', () => {
    const state = run([
      tick('0:0', 0),
      press(0),
      tick('0:0', HINT_HESITATION_MS * 2, false),
      tick('0:0', HINT_HESITATION_MS * 2 + 10),
    ])
    expect(state.visible).toBe(false)
  })

  it('does not count a wait after a mode change until the next key', () => {
    const state = run([tick('0:0', 0), press(0), { type: 'rest' }, tick('0:0', HINT_HESITATION_MS * 2)])
    expect(state.visible).toBe(false)
  })

  it('starts over at the end of a run, as on a piece just opened, the ✕ kept', () => {
    expect(hintStep(revealed(), { type: 'restart' })).toEqual(initialHint())
    expect(run([{ type: 'dismiss' }, { type: 'restart' }], revealed()).dismissed).toBe(true)
  })

  it('goes away once the notes come promptly and clean for a stretch', () => {
    // The note it came up for, found at last, is not part of the stretch.
    let state = hintStep(revealed(), tick('0:1', 1000))
    for (let i = 1; i < HINT_FLUENT_NOTES; i++) state = hintStep(state, tick(`1:${i}`, 1000 + 1000 * i))
    expect(state.visible).toBe(true)
    state = hintStep(state, tick('2:0', 1000 + 1000 * HINT_FLUENT_NOTES))
    expect(state.visible).toBe(false)
  })

  it('starts the stretch over on a slow or fumbled note', () => {
    let state = revealed()
    let now = 0
    const step = (key, gap) => {
      now += gap
      state = hintStep(state, tick(key, now))
    }
    step('0:1', 1000)
    for (let i = 1; i < HINT_FLUENT_NOTES; i++) step(`1:${i}`, 1000)
    step('2:0', HINT_FLUENT_MS + 1)
    expect(state.visible).toBe(true)
    expect(state.streak).toBe(0)
    step('2:1', 100)
    expect(state.streak).toBe(1)
    state = hintStep(state, wrong(now))
    step('2:2', 100)
    expect(state.streak).toBe(0)
  })

  it('stays away for the visit once dismissed', () => {
    let state = hintStep(revealed(), { type: 'dismiss' })
    expect(state.visible).toBe(false)
    state = run([tick('2:0', 0), wrong(1), wrong(2), wrong(3), tick('2:0', HINT_HESITATION_MS * 3)], state)
    expect(state.visible).toBe(false)
  })
})

describe('keyboardRange', () => {
  it('spans whole octaves around the notes', () => {
    expect(keyboardRange([50, 62, 79])).toEqual({ low: 48, high: 83 })
  })

  it('draws at least two octaves, growing toward middle C', () => {
    expect(keyboardRange([62, 67])).toEqual({ low: 48, high: 71 })
    expect(keyboardRange([74, 79])).toEqual({ low: 60, high: 83 })
    expect(keyboardRange([40, 45])).toEqual({ low: 36, high: 59 })
  })

  it('stops at the ends of a piano', () => {
    expect(keyboardRange([21, 108])).toEqual({ low: 21, high: 108 })
  })
})

describe('keyLayout', () => {
  it('places each black key over the gap after the white keys before it', () => {
    const { keys, whites } = keyLayout({ low: 60, high: 71 })
    expect(whites).toBe(7)
    expect(keys.filter((k) => k.black).map((k) => [k.midi, k.at])).toEqual([
      [61, 1],
      [63, 2],
      [66, 4],
      [68, 5],
      [70, 6],
    ])
  })
})
