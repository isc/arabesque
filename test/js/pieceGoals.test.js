import { describe, it, expect } from 'vitest'
import { goalLines, goalNews, pieceGoals, statusProgress } from '../../public/js/pieceGoals.js'
import { runSize } from '../../public/js/noteExtraction.js'

// A run as getAllPlaythroughs hands it over.
const run = (startedAt, wrongNotes, extra = {}) => ({ startedAt, wrongNotes, holes: null, hands: 'both', strict: null, ...extra })
// The size of the C minor prelude, near enough: a star is 54 or 21 wrong notes,
// and 30 or 12 holes.
const PRELUDE = { notes: 1091, attacks: 608 }

const bars = (...cleans) => Object.fromEntries(cleans.map((cleanAttempts, i) => [i, { cleanAttempts }]))

describe('statusProgress', () => {
  it('has nothing to say of a piece unplayed or at the top', () => {
    expect(statusProgress(null, [0])).toBe(null)
    expect(statusProgress({ status: 'repertoire', measures: bars(10) }, [0])).toBe(null)
  })

  it('offers the one bar holding a piece back, however far the rest is past the mark', () => {
    const progress = statusProgress(
      { status: 'perfectionnement', timesCompleted: 39, practiceDays: ['a', 'b', 'c'], measures: bars(12, 10, 9) },
      [0, 1, 2],
    )
    expect(progress.status).toBe('repertoire')
    expect(progress.rules.map((rule) => [rule.done, rule.progress])).toEqual([
      [true, '39/10'],
      [true, '3/3'],
    ])
    expect(progress.bars).toMatchObject({ done: false, progress: '2/3' })
    expect(progress.closest).toEqual({ bar: 2, label: expect.stringContaining('bar 3 (9/10)') })
  })

  it('maps every bar there is to play, those never played too, filling with the clean passes', () => {
    const { map } = statusProgress({ status: 'perfectionnement', measures: bars(12, 5) }, [0, 1, 2])
    expect(map.map(({ bar, done, fill }) => [bar, done, fill])).toEqual([
      [0, true, 1],
      [1, false, 0.5],
      [2, false, 0],
    ])
  })

  it('offers the bar closest to the mark, the earliest of a tie', () => {
    const { closest } = statusProgress({ status: 'perfectionnement', measures: bars(1, 8, 8, 3) }, [0, 1, 2, 3])
    expect(closest.bar).toBe(1)
  })

  it('asks for Refining of a piece with no status yet, and offers nothing once enough bars are clean', () => {
    const progress = statusProgress({ status: null, timesCompleted: 1, measures: bars(3, 0) }, [0, 1])
    expect(progress.heading).toMatch(/Refining/)
    expect(progress.bars).toMatchObject({ done: true, progress: '1/1' })
    expect(progress.closest).toBe(null)
  })
})

describe('pieceGoals', () => {
  it('earns a star at each share of the notes, and says what the next one allows', () => {
    const accuracy = (wrongNotes) => pieceGoals([run('2026-10-01T12:00:00Z', wrongNotes)], PRELUDE).accuracy
    expect(accuracy(55)).toMatchObject({ stars: 0, limit: 54 })
    expect(accuracy(29)).toMatchObject({ stars: 1, limit: 21, best: 29 })
    expect(accuracy(21)).toMatchObject({ stars: 2, limit: 0 })
    expect(accuracy(0)).toMatchObject({ stars: 3, limit: null })
  })

  it('keeps the best run: a bad evening costs no star', () => {
    const { accuracy } = pieceGoals([run('2026-10-02T12:00:00Z', 108), run('2026-10-01T12:00:00Z', 29)], PRELUDE)
    expect(accuracy).toMatchObject({ best: 29, stars: 1 })
  })

  it('reads runs in full with both hands alone', () => {
    const { accuracy, firstGo } = pieceGoals(
      [run('2026-10-01T12:00:00Z', 0, { hands: 'right' }), run('2026-10-01T13:00:00Z', 0, { strict: { hit: 1, total: 1 } })],
      PRELUDE,
    )
    expect(accuracy).toMatchObject({ best: null, stars: 0 })
    expect(firstGo).toEqual({ days: 0, done: 0 })
  })

  it('leaves out of steadiness a run that could not say', () => {
    const { steadiness } = pieceGoals([run('2026-10-01T12:00:00Z', 0), run('2026-10-02T12:00:00Z', 0, { holes: 31 })], PRELUDE)
    expect(steadiness).toMatchObject({ best: 31, stars: 0, limit: 30 })
  })

  it("holds each day's first run alone to the first go", () => {
    const { firstGo } = pieceGoals(
      [
        run('2026-10-01T18:00:00Z', 0),
        run('2026-10-01T12:00:00Z', 100),
        run('2026-10-02T12:00:00Z', 54),
        run('2026-10-03T12:00:00Z', 55),
      ],
      PRELUDE,
    )
    expect(firstGo).toEqual({ days: 3, done: 1 })
  })
})

describe('goalLines', () => {
  it('says the record and the next star, and what has yet to be measured', () => {
    const [accuracy, steadiness, firstGo] = goalLines(pieceGoals([run('2026-10-01T12:00:00Z', 29)], PRELUDE))
    expect(accuracy).toMatchObject({ earned: '★', left: '☆☆', value: '29 wrong notes', note: 'Next star: 21 wrong notes at most' })
    expect(accuracy.progress).toBeCloseTo(22 / 30)
    expect(steadiness).toMatchObject({ earned: '', left: '☆☆☆', value: '—', note: 'Measured from the next full run', progress: 0 })
    expect(firstGo).toMatchObject({ value: '1 day of 1', progress: 1 })
  })

  it('says it when nothing is left to earn', () => {
    const [accuracy] = goalLines(pieceGoals([run('2026-10-01T12:00:00Z', 0)], PRELUDE))
    expect(accuracy).toMatchObject({ earned: '★★★', left: '', value: 'no wrong note', note: 'All the stars are in', progress: 1 })
  })
})

// Most recent first, as getAllPlaythroughs hands them over.
describe('goalNews', () => {
  it('announces the stars the run earned', () => {
    const runs = [run('2026-10-02T18:00:00Z', 21), run('2026-10-02T12:00:00Z', 60)]
    expect(goalNews(runs, PRELUDE)).toBe('⭐ Accuracy ★★☆')
  })

  it("announces the day's first run when it holds up", () => {
    const runs = [run('2026-10-03T12:00:00Z', 50), run('2026-10-02T12:00:00Z', 40)]
    expect(goalNews(runs, PRELUDE)).toBe('⭐ First go achieved')
  })

  it('otherwise names the star closest to hand', () => {
    const runs = [run('2026-10-02T18:00:00Z', 108, { holes: 40 }), run('2026-10-02T12:00:00Z', 29, { holes: 31 })]
    // One hole past its star, where the notes are eight wrong past theirs.
    expect(goalNews(runs, PRELUDE)).toBe('Next star: Steadiness ★☆☆, 30 holes at most. Best run: 31 holes.')
  })

  it('says nothing of a run no goal reads, or once every star is in', () => {
    expect(goalNews([run('2026-10-02T12:00:00Z', 0, { hands: 'left' })], PRELUDE)).toBe('')
    expect(goalNews([], PRELUDE)).toBe('')
    const perfect = [run('2026-10-02T18:00:00Z', 5, { holes: 0 }), run('2026-10-02T12:00:00Z', 0, { holes: 0 })]
    expect(goalNews(perfect, PRELUDE)).toBe('')
  })
})

describe('runSize', () => {
  const measure = (...notes) => ({ notes })

  it('counts a chord as one attack, and a repeated bar each time it is played', () => {
    const c4 = { timestamp: 0 }
    const e4 = { timestamp: 0 }
    const again = { timestamp: 1 }
    expect(runSize([measure(c4, e4), measure(again)])).toMatchObject({ notes: 3, attacks: 2 })
  })

  it('leaves out what no key strikes', () => {
    const allNotes = [measure({ timestamp: 0 }, { timestamp: 0.25, isGrace: true }, { timestamp: 0.5, isTieContinuation: true })]
    expect(runSize(allNotes)).toMatchObject({ notes: 1, attacks: 1 })
  })

  it('names each bar with something to play once', () => {
    const bar = (sourceMeasureIndex, ...notes) => ({ sourceMeasureIndex, notes })
    const allNotes = [bar(0, { timestamp: 0 }), bar(1), bar(2, { timestamp: 2 }), bar(0, { timestamp: 3 })]
    expect(runSize(allNotes).bars).toEqual([0, 2])
  })
})
