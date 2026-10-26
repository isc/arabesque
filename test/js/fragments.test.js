import { describe, it, expect } from 'vitest'
import { fragmentOf, fragmentsToReinforce } from '../../public/js/fragments.js'

// Three bars of quavers for the right hand, a crotchet beat: two attacks a
// beat, eight a bar.
const POSITIONS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
const model = {
  notes: new Map([0, 1, 2].flatMap((bar) => POSITIONS.map((position, i) => [`m${bar}:0:0:${i}`, { bar, position, hand: 'right' }]))),
  bars: [0, 1, 2].map(() => ({ duration: 1, beat: 0.25, positions: POSITIONS })),
}

// A traversal of bars `from` to `to`, holes on the notes listed as
// "bar:attack", wrong keys owed for those listed in `wrong`.
function traversal({ from = 0, to = 2, holes = [], wrong = [], hands = 'right', training = false } = {}) {
  const attacks = []
  for (let bar = from; bar <= to; bar++) {
    POSITIONS.forEach((position, i) => attacks.push({ sourceBar: bar, position, hole: holes.includes(`${bar}:${i}`) }))
  }
  return { attacks, wrong: wrong.map((at) => ({ key: `m${at.replace(':', ':0:0:')}` })), hands, training }
}

const offered = (traversals, options = {}) =>
  fragmentsToReinforce(traversals, model, { hands: 'right', ...options }).map(({ from, until }) => [from, until])

describe('fragmentOf', () => {
  it('works a spot on a downbeat with the last beat of the bar before', () => {
    expect(fragmentOf(model, { bar: 1, beat: 0 })).toEqual({ from: { bar: 0, position: 0.75 }, until: { bar: 1, position: 0.25 } })
  })

  it('works a spot inside a bar with the beat before it', () => {
    expect(fragmentOf(model, { bar: 1, beat: 2 })).toEqual({ from: { bar: 1, position: 0.25 }, until: { bar: 1, position: 0.75 } })
  })

  it('reaches back to the last note played when the beat before holds none', () => {
    const held = { ...model, bars: [{ duration: 1, beat: 0.25, positions: [0] }, model.bars[1]] }
    expect(fragmentOf(held, { bar: 1, beat: 0 })).toEqual({ from: { bar: 0, position: 0 }, until: { bar: 1, position: 0.25 } })
  })

  it('has nothing before the first bar to reach back to', () => {
    expect(fragmentOf(model, { bar: 0, beat: 0 })).toEqual({ from: { bar: 0, position: 0 }, until: { bar: 0, position: 0.25 } })
  })
})

describe('fragmentsToReinforce', () => {
  // The stall of feedback 534a800b: the downbeat on time, the note after it late.
  it('offers a stall after a downbeat as the way in from the bar before', () => {
    expect(offered([traversal({ holes: ['1:1'] })])).toEqual([[{ bar: 0, position: 0.75 }, { bar: 1, position: 0.25 }]])
  })

  it('offers a wrong note at the beat it was owed on', () => {
    expect(offered([traversal({ wrong: ['2:5'] })])).toEqual([[{ bar: 2, position: 0.25 }, { bar: 2, position: 0.75 }]])
  })

  it('settles a spot once its whole fragment is played cleanly three times', () => {
    const fumbled = traversal({ holes: ['1:1'] })
    expect(offered([fumbled, traversal(), traversal()])).toHaveLength(1)
    expect(offered([fumbled, traversal(), traversal(), traversal()])).toEqual([])
  })

  // A bar drilled alone starts on its downbeat: the way in is never played.
  it('counts no pass that leaves out the beat before', () => {
    const fromTheDownbeat = () => traversal({ from: 1, to: 1 })
    expect(offered([traversal({ holes: ['1:1'] }), fromTheDownbeat(), fromTheDownbeat(), fromTheDownbeat()])).toHaveLength(1)
  })

  it('starts the count over after a fumble in a run, not in a drill', () => {
    const fumbled = traversal({ holes: ['1:1'] })
    const clean = traversal()
    expect(offered([fumbled, clean, clean, fumbled, clean])).toHaveLength(1)
    const spoiled = { ...fumbled, training: true }
    expect(offered([fumbled, clean, spoiled, clean, clean])).toEqual([])
  })

  it('offers and ranks spots by the runs alone, what a drill fumbles adding nothing', () => {
    const drilled = traversal({ from: 2, to: 2, holes: ['2:5'], training: true })
    expect(offered([drilled, drilled, drilled])).toEqual([])
    const runs = [traversal({ holes: ['1:1', '2:5'] }), traversal({ holes: ['1:1'] })]
    expect(offered([...runs, drilled, drilled, drilled, drilled])).toEqual([
      [{ bar: 0, position: 0.75 }, { bar: 1, position: 0.25 }],
      [{ bar: 2, position: 0.25 }, { bar: 2, position: 0.75 }],
    ])
  })

  it('counts a note searched for over many keys as one fault', () => {
    const searched = traversal({ wrong: ['2:5', '2:5', '2:5', '2:5', '2:5'] })
    const stalled = traversal({ holes: ['1:1'] })
    expect(offered([searched, stalled, stalled], { limit: 1 })).toEqual([[{ bar: 0, position: 0.75 }, { bar: 1, position: 0.25 }]])
  })

  it('answers for one hand selection at a time', () => {
    const both = traversal({ holes: ['1:1'], hands: 'both' })
    expect(offered([both])).toEqual([])
    expect(offered([both], { hands: 'both' })).toHaveLength(1)
  })

  it('drills fragments that overlap as one, the most fumbled first', () => {
    const traversals = [traversal({ holes: ['1:1', '1:3', '2:5'] }), traversal({ holes: ['2:5'] }), traversal({ wrong: ['2:4'] })]
    expect(fragmentsToReinforce(traversals, model, { hands: 'right' })).toEqual([
      { from: { bar: 2, position: 0.25 }, until: { bar: 2, position: 0.75 }, hands: 'right', faults: 3 },
      { from: { bar: 0, position: 0.75 }, until: { bar: 1, position: 0.5 }, hands: 'right', faults: 2 },
    ])
  })

  it('keeps to the best `limit` spots', () => {
    const traversals = [traversal({ holes: ['0:3', '2:5'] }), traversal({ holes: ['2:5'] })]
    expect(offered(traversals, { limit: 1 })).toEqual([[{ bar: 2, position: 0.25 }, { bar: 2, position: 0.75 }]])
  })
})
