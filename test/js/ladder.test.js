import { describe, it, expect } from 'vitest'
import {
  SLOW_CLICK,
  STUCK_AFTER,
  climbOn,
  isGuided,
  ladderOf,
  rungs,
  startOfTurn,
  stepOf,
} from '../../public/js/ladder.js'
import fr from '../../public/js/locales/fr.js'

const kinds = (ladder) => ladder.map((steps) => steps.map((step) => step.kind))
// A passage for two hands, drilled with both, and the tempo to click it at.
const BPM = 60
const full = ladderOf({ hands: 'both', twoHanded: true, bpm: BPM, turns: 3 })
const [build, slowClick, click] = full

const clean = { clean: true }
const spoiled = (wrong = {}) => ({ clean: false, wrong: { right: 0, left: 0, ...wrong } })
// A passage taken through goes at the turn `steps`, from its start.
const after = (steps, ...goes) =>
  goes.reduce(({ climb }, go) => climbOn(steps, climb, go), { climb: startOfTurn(), earned: false })
// Where a step spoiled STUCK_AFTER times over leaves the passage.
const stuck = (steps, wrong = {}) => after(steps, ...Array(STUCK_AFTER).fill(spoiled(wrong))).climb

describe('ladderOf', () => {
  it('builds a two-handed passage a hand at a time, then plays it to a slow click and to the tempo', () => {
    expect(kinds(full)).toEqual([['right', 'left', 'together'], ['slowClick'], ['click']])
    expect(build.map((step) => step.hands)).toEqual(['right', 'left', 'both'])
    expect(full.flat().map((step) => step.click)).toEqual([null, null, null, Math.round(BPM * SLOW_CLICK), BPM])
  })

  it('takes nothing apart for one hand: a passage with notes for one, or a drill of one', () => {
    expect(kinds(ladderOf({ hands: 'both', twoHanded: false, bpm: BPM, turns: 3 }))).toEqual([['whole'], ['slowClick'], ['click']])
    expect(kinds(ladderOf({ hands: 'left', twoHanded: true, bpm: BPM, turns: 3 }))).toEqual([['whole'], ['slowClick'], ['click']])
  })

  it('goes to the tempo at once with a single turn after the first', () => {
    expect(kinds(ladderOf({ hands: 'both', twoHanded: true, bpm: BPM, turns: 2 }))).toEqual([['right', 'left', 'together'], ['click']])
  })

  it('asks for a clean repetition a turn where there is no tempo to click at', () => {
    const plain = ladderOf({ hands: 'right', twoHanded: false, turns: 3 })
    expect(kinds(plain)).toEqual([['whole'], ['again'], ['confirm']])
    expect(isGuided(plain)).toBe(false)
    expect(isGuided(full)).toBe(true)
    expect(isGuided(ladderOf({ hands: 'both', twoHanded: true, turns: 3 }))).toBe(true)
    expect(isGuided(ladderOf({ hands: 'right', twoHanded: false, bpm: BPM, turns: 3 }))).toBe(true)
  })
})

describe('climbOn', () => {
  it('climbs a step a clean go, the last of the turn earning its dot', () => {
    expect(stepOf(build, after(build, clean).climb).kind).toBe('left')
    expect(after(build, clean, clean).earned).toBe(false)
    expect(after(build, clean, clean, clean)).toEqual({ climb: startOfTurn(), earned: true })
    expect(after(click, clean).earned).toBe(true)
  })

  it('stays on a step a go spoiled', () => {
    const { climb, earned } = after(build, clean, spoiled(), spoiled())
    expect(earned).toBe(false)
    expect(stepOf(build, climb).kind).toBe('left')
    expect(climb.fails).toBe(2)
  })

  it('takes alone the hand whose notes keep coming out wrong, then goes back up', () => {
    const down = after(build, clean, clean, spoiled({ left: 1 }), spoiled({ right: 1, left: 2 }), spoiled()).climb
    expect(stepOf(build, down)).toMatchObject({ kind: 'left', hands: 'left', click: null })
    expect(down.step).toBe(2)

    const back = climbOn(build, down, clean)
    expect(back.earned).toBe(false)
    expect(stepOf(build, back.climb).kind).toBe('together')
    expect(climbOn(build, back.climb, clean).earned).toBe(true)
  })

  // The hand goes on to the same click: it is the hand that is not there yet,
  // not the tempo.
  it('takes a hand alone to the click it was stuck at', () => {
    const down = stuck(click, { right: 2 })
    expect(stepOf(click, down)).toMatchObject({ kind: 'right', hands: 'right', click: BPM })
  })

  it('slows the click where no note points at a hand: the timing is what spoils it', () => {
    const down = stuck(click)
    expect(stepOf(click, down)).toMatchObject({ kind: 'slower', hands: 'both', click: Math.round(BPM * SLOW_CLICK) })
    expect(stepOf(click, climbOn(click, down, clean).climb).kind).toBe('click')
  })

  it('counts the spoiled goes in a row: a clean one between them starts over', () => {
    const { climb } = after(build, spoiled({ right: 1 }), spoiled({ right: 1 }), clean, spoiled({ right: 1 }))
    expect(climb.detour).toBe(null)
    expect(climb.fails).toBe(1)
  })

  it('says to slow down where there is nothing to step down to', () => {
    const [whole] = ladderOf({ hands: 'right', twoHanded: false, turns: 3 })
    const steady = stuck(whole, { right: 1 })
    expect(steady).toMatchObject({ detour: null, hint: 'steady', fails: 0 })
    // Until a clean go comes.
    expect(climbOn(whole, steady, spoiled()).climb.hint).toBe('steady')
    // Nor from a step already stepped down to.
    const down = after(build, clean, clean, ...Array(STUCK_AFTER * 2).fill(spoiled({ right: 1 }))).climb
    expect(down).toMatchObject({ hint: 'steady' })
    expect(stepOf(build, down).kind).toBe('right')
  })
})

describe('rungs', () => {
  it('lists every step, those behind the passage and the one under way', () => {
    const climb = { ...startOfTurn(), step: 1 }
    expect(rungs(full, 0, climb)).toEqual([
      { kind: 'right', done: true, now: false },
      { kind: 'left', done: false, now: true },
      { kind: 'together', done: false, now: false },
      { kind: 'slowClick', done: false, now: false },
      { kind: 'click', done: false, now: false },
    ])
    expect(rungs(full, 2, startOfTurn()).map((rung) => rung.done)).toEqual([true, true, true, true, false])
  })
})

// Every step the ladder can stand on is named on the board, and the ones it is
// built of say what they ask for: a key missing from the catalog shows as the
// key itself (t falls back to it), which locales.test.js cannot see when both
// languages lack it.
describe('the words for each step', () => {
  const ladders = [full, ladderOf({ hands: 'both', twoHanded: false, bpm: BPM, turns: 3 }), ladderOf({ hands: 'both', twoHanded: true, turns: 3 })]
  const built = ladders.flat(2)
  const detours = [stuck(click, { left: 1 }), stuck(click), stuck(slowClick)].map((climb) => climb.detour)

  it('names them all, and says what each step a ladder is built of asks for', () => {
    for (const { kind } of [...built, ...detours]) expect(fr.score.ladderName[kind], kind).toBeTypeOf('string')
    for (const { kind } of built) expect(fr.score.ladderAsk[kind], kind).toBeTypeOf('string')
    for (const { kind } of detours) expect(fr.score.ladderDown[kind], kind).toBeTypeOf('string')
  })
})
