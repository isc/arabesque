import { describe, it, expect } from 'vitest'
import {
  atPace,
  attackNumber,
  barsRepeatingTheirHalf,
  eventsOf,
  figuresOf,
  halvesOf,
  paceOf,
  splitByPace,
  traversals,
} from '../../public/js/noteLogAnalysis.js'

// Two bars of four crotchets over two minims, both hands: the model a score
// provider hands over (noteLogAnalysis.js).
const POSITIONS = [0, 0.25, 0.5, 0.75]
const model = {
  notes: new Map(
    [0, 1].flatMap((bar) => [
      ...POSITIONS.map((position, i) => [
        `m${bar}:0:0:${i}`,
        { bar, staff: 0, position, midi: 60 + i, grace: false, fermata: false },
      ]),
      ...[0, 0.5].map((position, i) => [
        `m${bar}:1:4:${i}`,
        { bar, staff: 1, position, midi: 48 + i, grace: false, fermata: false },
      ]),
    ]),
  ),
  bars: [0, 1].map(() => ({ duration: 1, tempo: null, positions: POSITIONS, beat: 0.5 })),
}

// The keys each attack of a bar is completed by, in score order.
const attackKeys = (b) => [
  [`m${b}:0:0:0`, `m${b}:1:4:0`],
  [`m${b}:0:0:1`],
  [`m${b}:0:0:2`, `m${b}:1:4:1`],
  [`m${b}:0:0:3`],
]

// A note log of one segment as noteLog.js writes it, from [at, code, key, bar,
// pitch] events.
function log(events) {
  const keys = [...new Set(events.map(([, , key]) => key).filter(Boolean))]
  return eventsOf([
    {
      startedAt: new Date(0).toISOString(),
      keys,
      t: events.map(([at]) => at),
      e: events.map(([, code]) => code).join(''),
      p: events.map(([, , , , pitch = 60]) => pitch),
      v: events.map(() => 64),
      n: events.map(([, , key]) => (key ? keys.indexOf(key) : -1)),
      b: events.map(([, , , b]) => b),
    },
  ])
}

// The two bars played at one attack every `pace` ms, `late` ms more before the
// attacks listed in `delays` ("bar:attack", 0-based). `keysOf` gives a bar's
// attacks in another model.
function played(pace, delays = {}, keysOf = attackKeys) {
  const events = []
  let at = 0
  for (const b of [0, 1]) {
    keysOf(b).forEach((keys, i) => {
      at += pace + (delays[`${b}:${i}`] ?? 0)
      for (const key of keys) events.push([at, 'd', key, b])
    })
  }
  return events
}

// `events` with a wrong key played 100 ms before the note `key` it was owed for.
function withWrongKeyBefore(events, key) {
  const owedAt = events.findIndex(([, , owed]) => owed === key)
  const [at, , , bar] = events[owedAt]
  return events.toSpliced(owedAt, 0, [at - 100, 'w', key, bar])
}

describe('eventsOf', () => {
  it('puts the columns of several segments back together, in time order', () => {
    const segment = (startedAt, t) => ({
      startedAt,
      keys: ['m0:0:0:0'],
      t,
      e: 'du',
      p: [60, 60],
      v: [64, 0],
      n: [0, -1],
      b: [0, -1],
    })
    const events = eventsOf([segment(1000, [0, 10]), segment(new Date(500).toISOString(), [0, 10])])
    expect(events.map((e) => [e.at, e.code, e.key])).toEqual([
      [500, 'd', 'm0:0:0:0'],
      [510, 'u', null],
      [1000, 'd', 'm0:0:0:0'],
      [1010, 'u', null],
    ])
  })
})

describe('attackNumber', () => {
  it('numbers the attacks of a bar from its downbeat', () => {
    expect(attackNumber(model, 1, 0)).toBe(1)
    expect(attackNumber(model, 1, 0.75)).toBe(4)
  })
})

describe('traversals', () => {
  it('finds a hole where the flow stopped, by the app’s rule', () => {
    const [run] = traversals(log(played(500, { '1:1': 1500 })), model)
    const holes = run.attacks.filter((a) => a.hole)
    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ sourceBar: 1, position: 0.25, ms: 2000 })
  })

  it('tells a hole at the bar line, the join, from one inside the bar', () => {
    const [run] = traversals(log(played(500, { '1:0': 1500 })), model)
    expect(run.attacks.find((a) => a.hole)).toMatchObject({ sourceBar: 1, position: 0, entry: true, joined: true })
  })

  it('counts the time a wrong note took as the mistake’s, not a hole', () => {
    const [run] = traversals(log(withWrongKeyBefore(played(500, { '1:1': 1500 }), 'm1:0:0:1')), model)
    expect(run.wrong).toHaveLength(1)
    expect(run.attacks.find((a) => a.position === 0.25 && a.bar === 1)).toMatchObject({ faulted: true, hole: false })
  })

  // A crotchet every 500 ms: what reinforcement ranks its spots by.
  it('says how long each fault held the traversal up, beyond the pace', () => {
    const [stalled] = traversals(log(played(500, { '1:1': 1500 })), model)
    expect(stalled.attacks.filter((a) => a.lost > 0)).toMatchObject([{ sourceBar: 1, position: 0.25, lost: 1500 }])

    const [searched] = traversals(log(withWrongKeyBefore(played(500, { '1:1': 1500 }), 'm1:0:0:1')), model)
    expect(searched.attacks.filter((a) => a.lost > 0)).toMatchObject([
      { sourceBar: 1, position: 0.25, faulted: true, lost: 1500 },
    ])
  })

  it('says the hands ticked as each traversal began, both when the log does not say', () => {
    const once = played(500)
    const again = once.map(([at, ...rest]) => [at + 5000, ...rest])
    const runs = traversals(log([...once, [4900, 'h', null, -1, 1], ...again]), model)
    expect(runs.map((r) => r.hands)).toEqual(['both', 'right'])
  })

  // With a minim beat here: the bar's two halves, each one chord.
  it('reads a traversal played in block chords beat by beat, as one of its own', () => {
    const once = played(500)
    const chords = [0, 1].flatMap((b) =>
      [attackKeys(b).slice(0, 2), attackKeys(b).slice(2)].map((beat, i) => beat.flat().map((key) => [6000 + 1000 * (2 * b + i), 'd', key, b])),
    )
    const runs = traversals(log([...once, [5500, 'c', null, -1, 1], ...chords.flat()]), model)
    expect(runs.map((r) => r.blockChords)).toEqual([false, true])
    expect(runs[1].attacks.map((a) => [a.sourceBar, a.position])).toEqual([[0, 0], [0, 0.5], [1, 0], [1, 0.5]])
  })

  it('starts a new traversal where the player went back to repeat', () => {
    const once = played(500)
    const again = once.filter(([, , , b]) => b === 1).map(([at, ...rest]) => [at + 5000, ...rest])
    const runs = traversals(log([...once, ...again]), model)
    expect(runs.map((r) => new Set(r.attacks.map((a) => a.bar)).size)).toEqual([2, 1])
  })
})

describe('figuresOf', () => {
  it('states the time lost, the holes and the bars with no fault', () => {
    const [run] = traversals(log(played(500, { '1:1': 1500 })), model)
    expect(paceOf(run)).toBe(2000)
    expect(figuresOf(run)).toEqual({ holes: 1, lost: 1500, wrongAttacks: 0, wrongKeys: 0, cleanBars: 1 })
  })

  // A key pressed too lightly, and the figure played on until it comes round.
  it('counts a figure played on through a missed key as one attack and many keys', () => {
    const events = played(500)
    const owed = 'm1:0:0:1'
    const [at, , , bar] = events.find(([, , key]) => key === owed)
    const replayed = [...Array(12).keys()].map((i) => [at - 400 + i * 20, 'w', owed, bar])
    const [run] = traversals(log([...events, ...replayed]), model)
    expect(figuresOf(run)).toMatchObject({ wrongAttacks: 1, wrongKeys: 12, cleanBars: 1 })
  })
})

describe('atPace', () => {
  const crotchetOf = (ms) => ms / 0.25

  it('forgives at a slower pace a stall that was only a hole at its own', () => {
    const [run] = traversals(log(played(300, { '1:1': 350 })), model)
    expect(figuresOf(run)).toMatchObject({ holes: 1, cleanBars: 1 })
    expect(figuresOf(atPace(run, crotchetOf(500)))).toMatchObject({ holes: 0, lost: 0, cleanBars: 2 })
  })

  it('weighs what a real stop lost against the slower pace', () => {
    const [run] = traversals(log(played(300, { '1:1': 1500 })), model)
    expect(figuresOf(atPace(run, crotchetOf(500)))).toMatchObject({ holes: 1, lost: 1300 })
  })

  it('weighs an interval a wrong key fell in against it too', () => {
    const [run] = traversals(log(withWrongKeyBefore(played(300, { '1:1': 700 }), 'm1:0:0:1')), model)
    expect(figuresOf(run).lost).toBe(700)
    expect(figuresOf(atPace(run, crotchetOf(500))).lost).toBe(500)
  })

  it('changes nothing at the pace the traversal held, and leaves it as it was', () => {
    const [run] = traversals(log(played(300, { '1:1': 1500 })), model)
    const figures = figuresOf(run)
    expect(figuresOf(atPace(run, paceOf(run)))).toEqual(figures)
    atPace(run, crotchetOf(500))
    expect(figuresOf(run)).toEqual(figures)
  })
})

describe('splitByPace', () => {
  it('gives the medians of the faster half and the slower, leaving the middle run out', () => {
    const figures = [7000, 1000, 5000, 3000, 2000, 6000, 4000].map((pace) => ({ pace, holes: pace / 1000 }))
    expect(splitByPace(figures)).toEqual({
      faster: { pace: 2000, holes: 2 },
      slower: { pace: 6000, holes: 6 },
    })
  })

  it('has nothing to compare in one run', () => {
    expect(splitByPace([{ pace: 1000 }])).toBeNull()
  })
})

describe('barsRepeatingTheirHalf', () => {
  // One bar of right-hand and left-hand pitches, each in equal notes.
  const barOf = (right, left) => {
    const staffNotes = (staff, pitches) =>
      pitches.map((midi, i) => [`m0:${staff}:${staff * 4}:${i}`, { bar: 0, staff, position: i / pitches.length, midi, grace: false }])
    return { notes: new Map([...staffNotes(0, right), ...staffNotes(1, left)]), bars: [{ duration: 1 }] }
  }

  it('finds a bar whose second half plays its first again', () => {
    expect(barsRepeatingTheirHalf(barOf([72, 65, 72, 65], [48, 48]))).toEqual(new Set([0]))
  })

  it('tells one note changed, in either hand', () => {
    expect(barsRepeatingTheirHalf(barOf([72, 65, 72, 66], [48, 48]))).toEqual(new Set())
    expect(barsRepeatingTheirHalf(barOf([72, 65, 72, 65], [48, 50]))).toEqual(new Set())
  })

  it('leaves out a bar that has nothing in its second half', () => {
    expect(barsRepeatingTheirHalf(barOf([72], []))).toEqual(new Set())
  })
})

describe('halvesOf', () => {
  // Two bars of a figure of four notes played twice over, one hand.
  const positions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
  const twice = {
    notes: new Map(
      [0, 1].flatMap((bar) =>
        positions.map((position, i) => [
          `m${bar}:0:0:${i}`,
          { bar, staff: 0, position, midi: 60 + (i % 4) + bar, grace: false, fermata: false },
        ]),
      ),
    ),
    bars: [0, 1].map(() => ({ duration: 1, tempo: null, positions, beat: 0.25 })),
  }
  const playedTwice = (delays) => played(300, delays, (b) => positions.map((_, i) => [`m${b}:0:0:${i}`]))

  it('sets each attack of the first half against the same one in the second', () => {
    const [run] = traversals(log(playedTwice({ '1:1': 1000 })), twice)
    const rows = halvesOf([run], twice)
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4])
    expect(rows[1].first).toMatchObject({ holes: 1, wrongAttacks: 0 })
    expect(rows[1].first.lost).toBeGreaterThan(900)
    expect(rows[1].second).toEqual({ holes: 0, lost: 0, wrongAttacks: 0 })
  })

  it('counts the second half apart, and a wrong key on the attack it fell on', () => {
    const [run] = traversals(log(withWrongKeyBefore(playedTwice({ '1:5': 1000 }), 'm1:0:0:2')), twice)
    const rows = halvesOf([run], twice)
    expect(rows[1].second.holes).toBe(1)
    expect(rows[1].first.holes).toBe(0)
    expect(rows[2].first.wrongAttacks).toBe(1)
  })

  it('adds up several runs, and reads nothing of a bar that plays no half twice', () => {
    const runs = traversals(log(playedTwice({ '1:1': 1000 })), twice)
    expect(halvesOf([...runs, ...runs], twice)[1].first.holes).toBe(2)
    expect(halvesOf(traversals(log(played(500)), model), model)).toEqual([])
  })
})
