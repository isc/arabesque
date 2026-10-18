import { describe, it, expect } from 'vitest'
import {
  createSteadiness,
  writtenBetween,
  HOLE_MIN_EXCESS_MS,
  LIVE_MIN,
} from '../../public/js/steadiness.js'

const SIXTEENTH = 1 / 16

// Bars of semiquavers in 4/4, as the C minor prelude writes them: `gaps` are
// the milliseconds before each attack after the first, `ms` the rest of them.
// Each attack's ref is its place in the sequence, which is what the verdicts
// are checked by.
function semiquavers(count, { ms = 300, gaps = {}, tempo = 60, from = 0, extra = () => ({}) } = {}) {
  let at = 0
  return Array.from({ length: count }, (_, i) => {
    if (i > 0) at += gaps[i] ?? ms
    const index = from + i
    return {
      at,
      measure: Math.floor(index / 16),
      position: (index % 16) * SIXTEENTH,
      measureDuration: 1,
      tempo,
      decorative: false,
      fermata: false,
      ref: index,
      ...extra(index),
    }
  })
}

function play(attacks, steadiness = createSteadiness()) {
  const verdicts = attacks.flatMap((attack) => steadiness.attack(attack))
  return { verdicts, steadiness }
}

const holes = (verdicts) => verdicts.filter((v) => v.hole).map((v) => v.ref)

describe('writtenBetween', () => {
  const at = (measure, position) => ({ measure, position, measureDuration: 0.75 })

  it('measures within a bar and across the line into the next', () => {
    expect(writtenBetween(at(2, 0.25), at(2, 0.5))).toBe(0.25)
    expect(writtenBetween(at(2, 0.5), at(3, 0))).toBe(0.25)
  })

  it('knows no distance to a bar further on', () => {
    expect(writtenBetween(at(2, 0.5), at(4, 0))).toBeNull()
  })
})

describe('createSteadiness', () => {
  it('finds no hole in an even run, and reports every join, entered then judged one beat long', () => {
    const { verdicts } = play(semiquavers(48))
    expect(holes(verdicts)).toEqual([])
    expect(verdicts.filter((v) => v.joined).map((v) => v.ref)).toEqual([16, 32])
    const judged = verdicts.filter((v) => v.entry && !v.joined)
    expect(judged.map((v) => v.ref)).toEqual([16, 32])
    for (const join of judged) expect(join.ratio).toBe(1)
  })

  it('catches the bar line that stops the run, both bars being clean', () => {
    const { verdicts } = play(semiquavers(32, { gaps: { 16: 900 } }))
    expect(holes(verdicts)).toEqual([16])
    expect(verdicts.find((v) => v.ref === 16 && !v.joined)).toMatchObject({ entry: true, ratio: 3 })
  })

  it('weighs an interval against what the score writes there', () => {
    // A quaver at the eighth attack: twice the time, and no hole.
    const attacks = semiquavers(16)
    for (const attack of attacks.slice(8)) {
      attack.position += SIXTEENTH
      attack.at += 300
    }
    expect(holes(play(attacks).verdicts)).toEqual([])
  })

  it('lets a stretched note at speed pass as unevenness rather than a hole', () => {
    const fast = 100
    const justUnder = semiquavers(16, { ms: fast, gaps: { 10: fast + HOLE_MIN_EXCESS_MS } })
    expect(holes(play(justUnder).verdicts)).toEqual([])
    const over = semiquavers(16, { ms: fast, gaps: { 10: fast + HOLE_MIN_EXCESS_MS + 1 } })
    expect(holes(play(over).verdicts)).toEqual([10])
  })

  it('judges the first intervals together once there are enough of them', () => {
    const attacks = semiquavers(16, { gaps: { 3: 1200 } })
    const steadiness = createSteadiness()
    const early = attacks.slice(0, LIVE_MIN).flatMap((attack) => steadiness.attack(attack))
    expect(early).toEqual([])
    expect(holes(steadiness.attack(attacks[LIVE_MIN]))).toEqual([3])
  })

  it('judges a short bar when it ends, and a shorter one not at all', () => {
    // Four crotchets, the third late: three intervals, enough for a median.
    const crotchets = [0, 1000, 3000, 4000].map((at, i) => ({ ...semiquavers(1)[0], at, position: i / 4, ref: i }))
    const { verdicts, steadiness } = play(crotchets)
    expect(verdicts).toEqual([])
    expect(holes(steadiness.close())).toEqual([2])

    const two = play(crotchets.slice(1))
    expect(two.steadiness.close()).toEqual([])
  })

  it('measures a repetition played slower on purpose against itself', () => {
    const steadiness = createSteadiness()
    play(semiquavers(16, { ms: 200 }), steadiness)
    expect(holes(steadiness.close())).toEqual([])
    const slower = play(semiquavers(16, { ms: 600 }), steadiness)
    expect(holes([...slower.verdicts, ...steadiness.close()])).toEqual([])
  })

  it('starts the count over at a new tempo, the join into it unjudged', () => {
    // The Presto: twice as fast from bar 2, and no hole for slowing into it.
    const before = semiquavers(16, { ms: 600 })
    const after = semiquavers(16, { ms: 300, tempo: 120, from: 16 }).map((a) => ({ ...a, at: a.at + before.at(-1).at + 1500 }))
    const { verdicts } = play([...before, ...after])
    expect(holes(verdicts)).toEqual([])
    expect(verdicts.filter((v) => v.ref === 16).map((v) => v.ratio)).toEqual([null])
  })

  it('holds no one to the pace through an ornament or out of a fermata', () => {
    const attacks = semiquavers(32, {
      gaps: { 9: 1500, 10: 1500, 20: 2000 },
      extra: (i) => ({ decorative: i === 9, fermata: i === 19 }),
    })
    expect(holes(play(attacks).verdicts)).toEqual([])
  })

  it('leaves the time a wrong note cost to the wrong note', () => {
    const attacks = semiquavers(16, { gaps: { 10: 1500 } })
    const steadiness = createSteadiness()
    const verdicts = attacks.flatMap((attack, i) => {
      if (i === 10) steadiness.fault()
      return steadiness.attack(attack)
    })
    expect(holes(verdicts)).toEqual([])
    expect(verdicts.some((v) => v.ref === 10)).toBe(false)
  })

  // The leap down into bar 33 of the C minor prelude, played an octave off:
  // entered, and its pace not judged.
  it('reports a bar entered after a wrong note, unjudged', () => {
    const attacks = semiquavers(32, { gaps: { 16: 900 } })
    const steadiness = createSteadiness()
    const verdicts = attacks.flatMap((attack, i) => {
      if (i === 16) steadiness.fault()
      return steadiness.attack(attack)
    })
    expect(verdicts.filter((v) => v.ref === 16)).toEqual([{ ref: 16, ratio: null, hole: false, entry: true, joined: true }])
    expect(holes(verdicts)).toEqual([])
  })

  it('takes nothing for a join it cannot measure', () => {
    // Bar 2 skipped, the hand ticked resting through it.
    const attacks = [...semiquavers(16), ...semiquavers(16, { from: 32 }).map((a) => ({ ...a, at: a.at + 7000 }))]
    const { verdicts } = play(attacks)
    expect(verdicts.some((v) => v.ref === 32)).toBe(false)
  })

  it('judges nothing of a traversal broken off, and starts the next afresh', () => {
    const steadiness = createSteadiness()
    expect(steadiness.underway).toBe(false)
    play(semiquavers(5), steadiness)
    expect(steadiness.underway).toBe(true)
    steadiness.discard()
    expect(steadiness.underway).toBe(false)
    const restart = semiquavers(16).map((a) => ({ ...a, at: a.at + 60_000 }))
    const { verdicts } = play(restart, steadiness)
    expect(holes([...verdicts, ...steadiness.close()])).toEqual([])
  })

  it('does not hold the gap between two traversals against the next', () => {
    const steadiness = createSteadiness()
    play(semiquavers(16), steadiness)
    steadiness.close()
    const again = semiquavers(16).map((a) => ({ ...a, at: a.at + 10_000 }))
    expect(holes(play(again, steadiness).verdicts)).toEqual([])
  })
})
