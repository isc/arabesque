import { describe, it, expect } from 'vitest'
import {
  rankingOf,
  wrongMeasuresText,
  playthroughCharts,
  resultCharts,
  withRunLines,
  hotMeasures,
  strictAccuracy,
  strictRunLabel,
} from '../../public/js/playthroughHistory.js'

// Runs as getAllPlaythroughs hands them over: most recent first.
const run = (day, durationMs, extra = {}) => ({
  startedAt: `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  durationMs,
  hands: 'both',
  strict: null,
  wrongNotes: 0,
  ...extra,
})

describe('rankingOf', () => {
  it('ranks the runs comparable with the last one, fastest first, the last one flagged', () => {
    const last = run(3, 70_000)
    const ranking = rankingOf([last, run(2, 60_000), run(1, 90_000), run(1, 50_000, { hands: 'right' })])

    expect(ranking.map((pt) => pt.durationMs)).toEqual([60_000, 70_000, 90_000])
    expect(ranking.filter((pt) => pt.isCurrent)).toEqual([{ ...last, isCurrent: true }])
  })
})

describe('wrongMeasuresText', () => {
  it('names a handful of measures by number, and only counts more', () => {
    expect(wrongMeasuresText([])).toBe('')
    expect(wrongMeasuresText([0, 4])).toContain('5')
    expect(wrongMeasuresText([0, 1, 2, 3, 4, 5, 6])).toContain('7')
    expect(wrongMeasuresText([0, 1, 2, 3, 4, 5, 6])).not.toContain('1, 2')
  })
})

describe('the evolution charts', () => {
  it('plots one point a run, and nothing below two runs', () => {
    expect(resultCharts([run(1, 60_000)])).toEqual([])
    const charts = resultCharts([run(3, 50_000), run(1, 60_000), run(2, 55_000)])
    expect(charts.map((c) => c.title)).toEqual(['Play-time trend', 'Wrong-note trend'])
    charts.forEach((c) => expect(c.svg.match(/<circle/g)).toHaveLength(3))
  })

  it('makes one chart per kind of run and hands, leaving out a group too short to plot', () => {
    const strict = (day, hit) => run(day, 60_000, { strict: { hit, total: 10, bpm: 80 } })
    const charts = playthroughCharts([run(2, 50_000), run(1, 60_000), strict(2, 9), strict(1, 7), run(1, 40_000, { hands: 'left' })])

    expect(charts).toHaveLength(2)
    expect(charts[0].title).not.toBe(charts[1].title)
    expect(charts.every((c) => c.svg.startsWith('<svg'))).toBe(true)
  })

  describe('of the wrong notes', () => {
    const wrongNotesChart = (runs) => resultCharts(runs)[1].svg
    const yAxis = (svg) => [...svg.matchAll(/class="chart-label">([^<]*)</g)].slice(0, 2).map((m) => m[1])
    const pointsAcross = (svg) => [...svg.matchAll(/<circle cx="([^"]*)"/g)].map((m) => m[1])

    it('counts in whole notes from zero, however clean the cleanest run', () => {
      const svg = wrongNotesChart([run(3, 50_000, { wrongNotes: 2 }), run(2, 55_000, { wrongNotes: 7 }), run(1, 60_000, { wrongNotes: 3 })])
      expect(yAxis(svg)).toEqual(['7', '0'])
    })

    it('keeps an axis for runs that were all clean', () => {
      expect(yAxis(wrongNotesChart([run(2, 50_000), run(1, 60_000)]))).toEqual(['1', '0'])
    })

    it('marks the most recent of the runs tied for best', () => {
      const points = wrongNotesChart([run(3, 50_000, { wrongNotes: 2 }), run(2, 55_000), run(1, 60_000)]).match(/<circle [^>]*>/g)
      expect(points.map((p) => p.includes('is-best'))).toEqual([false, true, false])
    })

    it('puts each run right under itself on the chart of its time', () => {
      const [time, wrongNotes] = resultCharts([run(3, 50_000, { wrongNotes: 1 }), run(2, 55_000), run(1, 60_000, { wrongNotes: 4 })])
      expect(pointsAcross(wrongNotes.svg)).toEqual(pointsAcross(time.svg))
    })
  })
})

describe('the words for a run', () => {
  it('gives a strict run its hit rate at its tempo', () => {
    expect(strictAccuracy({ hit: 9, total: 10 })).toBe(90)
    expect(strictRunLabel({ hit: 9, total: 10, bpm: 80 })).toMatch(/90\s*%.*80/)
  })

  it('puts a line under a day for each kind of run it holds', () => {
    const day = withRunLines({ date: '2026-09-01', fullPlaythroughs: [run(1, 60_000), run(1, 50_000, { hands: 'right' })] })
    expect(day.runLines).toHaveLength(2)
    expect(day.date).toBe('2026-09-01')
  })
})

describe('a line of the history', () => {
  it('holds its runs one by one, oldest first, each by its session', () => {
    const late = new Date(2026, 8, 1, 18, 37).toISOString()
    const early = new Date(2026, 8, 1, 9, 5).toISOString()
    const day = withRunLines({
      date: '2026-09-01',
      fullPlaythroughs: [run(1, 18_000, { sessionId: 'demo', startedAt: late, wrongNotes: 1 }), run(1, 60_000, { sessionId: 'mine', startedAt: early })],
    })

    expect(day.runLines).toHaveLength(1)
    const [first, second] = day.runLines[0].runs
    expect(first).toMatchObject({ sessionId: 'mine', label: '1m 0s (no wrong note)' })
    expect(first.time).toMatch(/09.05/)
    expect(second).toMatchObject({ sessionId: 'demo', label: '18s (1 wrong note)' })
    expect(second.time).toMatch(/06.37/)
  })

  it('says how steady each run was, when it was judged', () => {
    const day = withRunLines({
      date: '2026-09-01',
      fullPlaythroughs: [run(1, 50_000, { holes: 0 }), run(1, 60_000, { wrongNotes: 2, holes: 3 }), run(1, 70_000, { holes: null })],
    })

    expect(day.runLines[0].runs.map((r) => r.label)).toEqual([
      '1m 10s (no wrong note)',
      '1m 0s (2 wrong notes, 3 holes)',
      '50s (no wrong note, no holes)',
    ])
  })
})

describe('hotMeasures', () => {
  it('keeps the measures fumbled most often over two attempts or more, worst first', () => {
    const aggregate = {
      measures: {
        0: { totalAttempts: 10, errorRate: 0.2 },
        1: { totalAttempts: 1, errorRate: 1 },
        2: { totalAttempts: 4, errorRate: 0.5 },
        3: { totalAttempts: 6, errorRate: 0 },
      },
    }
    expect(hotMeasures(aggregate).map((m) => m.index)).toEqual([2, 0])
    expect(hotMeasures(null)).toEqual([])
  })
})
