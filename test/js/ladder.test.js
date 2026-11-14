import { describe, it, expect } from 'vitest'
import {
  CLEAN_ENOUGH,
  STUCK_AFTER,
  climbOn,
  isGuided,
  ladderOf,
  rungs,
  startOfTurn,
  stepOf,
} from '../../public/js/ladder.js'

const kinds = (ladder) => ladder.map((steps) => steps.map((step) => step.kind))
// A passage for two hands, drilled with both, and the pace of its runs.
const PACE = 4000
const full = ladderOf({ hands: 'both', twoHanded: true, pace: PACE, turns: 3 })
const [build, tempo] = full

const clean = { clean: true }
const spoiled = (wrong = {}) => ({ clean: false, wrong: { right: 0, left: 0, ...wrong } })
// A passage taken through repetitions of the turn `steps`, from its start.
const after = (steps, ...repetitions) =>
  repetitions.reduce(({ climb }, repetition) => climbOn(steps, climb, repetition), { climb: startOfTurn(), earned: false })

describe('ladderOf', () => {
  it('builds a two-handed passage a hand at a time, then asks for the pace, twice', () => {
    expect(kinds(full)).toEqual([['right', 'left', 'together'], ['tempo'], ['confirm']])
    expect(build.map((step) => step.hands)).toEqual(['right', 'left', 'both'])
    expect(full.flat().map((step) => step.pace)).toEqual([null, null, null, PACE, PACE])
  })

  it('takes nothing apart for one hand: a passage with notes for one, or a drill of one', () => {
    expect(kinds(ladderOf({ hands: 'both', twoHanded: false, pace: PACE, turns: 3 }))).toEqual([['whole'], ['tempo'], ['confirm']])
    expect(kinds(ladderOf({ hands: 'left', twoHanded: true, pace: PACE, turns: 3 }))).toEqual([['whole'], ['tempo'], ['confirm']])
  })

  it('asks for a clean repetition a turn where no pace is known', () => {
    const plain = ladderOf({ hands: 'right', twoHanded: false, turns: 3 })
    expect(kinds(plain)).toEqual([['whole'], ['again'], ['confirm']])
    expect(isGuided(plain)).toBe(false)
    expect(isGuided(full)).toBe(true)
    expect(isGuided(ladderOf({ hands: 'both', twoHanded: true, turns: 3 }))).toBe(true)
    expect(isGuided(ladderOf({ hands: 'right', twoHanded: false, pace: PACE, turns: 3 }))).toBe(true)
  })
})

describe('climbOn', () => {
  it('climbs a step a clean repetition, the last of the turn earning its dot', () => {
    expect(stepOf(build, after(build, clean).climb).kind).toBe('left')
    expect(after(build, clean, clean).earned).toBe(false)
    expect(after(build, clean, clean, clean)).toEqual({ climb: startOfTurn(), earned: true })
  })

  it('stays on a step a repetition spoiled', () => {
    const { climb, earned } = after(build, clean, spoiled(), spoiled())
    expect(earned).toBe(false)
    expect(stepOf(build, climb).kind).toBe('left')
    expect(climb.fails).toBe(2)
  })

  it('takes alone the hand whose notes keep coming out wrong, then goes back up', () => {
    const stuck = after(build, clean, clean, spoiled({ left: 1 }), spoiled({ right: 1, left: 2 }), spoiled()).climb
    expect(stepOf(build, stuck)).toMatchObject({ kind: 'left', hands: 'left' })
    expect(stuck.step).toBe(2)

    const back = climbOn(build, stuck, clean)
    expect(back.earned).toBe(false)
    expect(stepOf(build, back.climb).kind).toBe('together')
    expect(climbOn(build, back.climb, clean).earned).toBe(true)
  })

  it('counts the spoiled repetitions in a row: a clean one between them starts over', () => {
    const slowly = { clean: true, pace: PACE * 2 }
    const { climb } = after(tempo, spoiled({ right: 1 }), spoiled({ right: 1 }), slowly, spoiled({ right: 1 }))
    expect(climb.detour).toBe(null)
    expect(climb.fails).toBe(1)
  })

  it('lets go of the pace for a repetition where no wrong note points at a hand', () => {
    const stuck = after(tempo, spoiled(), spoiled(), spoiled()).climb
    expect(stepOf(tempo, stuck)).toMatchObject({ kind: 'together', hands: 'both', pace: null })
    expect(stepOf(tempo, climbOn(tempo, stuck, clean).climb).kind).toBe('tempo')
  })

  it('says to slow down where there is nothing to step down to', () => {
    const [whole] = ladderOf({ hands: 'right', twoHanded: false, turns: 3 })
    const stuck = after(whole, ...Array(STUCK_AFTER).fill(spoiled({ right: 1 }))).climb
    expect(stuck).toMatchObject({ detour: null, hint: 'steady', fails: 0 })
    // Until a clean repetition comes.
    expect(climbOn(whole, stuck, spoiled()).climb.hint).toBe('steady')
    // Nor from a step already stepped down to.
    const down = after(build, clean, clean, ...Array(STUCK_AFTER * 2).fill(spoiled({ right: 1 }))).climb
    expect(down).toMatchObject({ hint: 'steady' })
    expect(stepOf(build, down).kind).toBe('right')
  })

  it('holds a clean repetition under the pace, and says the pace it held', () => {
    const { climb, earned } = after(tempo, { clean: true, pace: PACE * 1.2 })
    expect(earned).toBe(false)
    expect(climb).toMatchObject({ hint: 'slow', played: PACE * 1.2, cleans: 1 })
    expect(climbOn(tempo, climb, spoiled()).climb.hint).toBe(null)
    expect(climbOn(tempo, climb, { clean: true, pace: PACE }).earned).toBe(true)
  })

  it('passes a step on its third clean repetition whatever the pace', () => {
    const slowly = { clean: true, pace: PACE * 2 }
    expect(after(tempo, ...Array(CLEAN_ENOUGH - 1).fill(slowly)).earned).toBe(false)
    expect(after(tempo, slowly, spoiled(), slowly, slowly).earned).toBe(true)
  })

  it('passes a repetition whose pace could not be measured', () => {
    expect(after(tempo, { clean: true, pace: null }).earned).toBe(true)
  })
})

describe('rungs', () => {
  it('lists every step, those behind the passage and the one under way', () => {
    const climb = { ...startOfTurn(), step: 1 }
    expect(rungs(full, 0, climb)).toEqual([
      { kind: 'right', done: true, now: false },
      { kind: 'left', done: false, now: true },
      { kind: 'together', done: false, now: false },
      { kind: 'tempo', done: false, now: false },
      { kind: 'confirm', done: false, now: false },
    ])
    expect(rungs(full, 2, startOfTurn()).map((rung) => rung.done)).toEqual([true, true, true, true, false])
  })
})
