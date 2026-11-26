import { describe, it, expect } from 'vitest'
import {
  rankingOf,
  otherTempi,
  runRecords,
  faultBars,
  faultChips,
  runFigure,
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

// A strict run at `bpm`: `hit` of ten notes in time, and what else it got wrong.
const strictRun = (day, hit, { bpm = 30, missed = 0, wrongNotes = 0, hands = 'both' } = {}) =>
  run(day, 60_000, { hands, strict: { hit, total: 10, missed, wrongNotes, offTempoEarly: 0, offTempoLate: 10 - hit - missed, bpm } })

describe('rankingOf, for strict runs', () => {
  // A hit rate says nothing of a run at another tempo.
  it('ranks the strict runs at the last one’s tempo, most accurate first', () => {
    const last = strictRun(3, 8)
    const ranking = rankingOf([last, strictRun(2, 9), strictRun(1, 6), strictRun(1, 10, { bpm: 40 }), run(1, 50_000)])
    expect(ranking.map(runFigure)).toEqual(['90%', '80%', '60%'])
    expect(ranking.find((pt) => pt.isCurrent).strict).toBe(last.strict)
  })
})

describe('otherTempi', () => {
  it('sums up the comparable strict runs at the other tempi, fastest first', () => {
    const last = strictRun(5, 6, { bpm: 31 })
    const runs = [last, strictRun(4, 10), strictRun(3, 7, { bpm: 31 }), strictRun(3, 8), strictRun(2, 9, { bpm: 29 }), strictRun(1, 10, { bpm: 32, hands: 'right' }), run(1, 50_000)]
    expect(otherTempi(runs)).toEqual([
      { bpm: 30, text: '30 BPM: 2×, best 100%' },
      { bpm: 29, text: '29 BPM: 1×, best 90%' },
    ])
  })

  it('has nothing to say of free runs, nor of strict runs all at one tempo', () => {
    expect(otherTempi([run(2, 60_000), run(1, 50_000)])).toEqual([])
    expect(otherTempi([strictRun(2, 6), strictRun(1, 9)])).toEqual([])
    expect(otherTempi([])).toEqual([])
  })
})

describe('runRecords', () => {
  it('says what a free run beat, and what the best before it was', () => {
    const records = runRecords([run(3, 50_000, { wrongNotes: 4, holes: 2 }), run(2, 60_000, { wrongNotes: 3, holes: 5 }), run(1, 55_000, { wrongNotes: 6, holes: 3 })])
    expect(records.map(({ key, value, before }) => [key, value, before])).toEqual([
      ['time', '50s', '55s'],
      ['holes', '2 holes', '3 holes'],
    ])
  })

  it('has nothing to say of a first run, nor of a run that beat nothing', () => {
    expect(runRecords([run(1, 50_000)])).toEqual([])
    expect(runRecords([run(2, 70_000, { wrongNotes: 2 }), run(1, 60_000, { wrongNotes: 1 })])).toEqual([])
  })

  // Accuracy and faults at the run's tempo; the tempo itself across them, a
  // first clean run said as one.
  it('weighs a strict run at its tempo, and its tempo against the clean runs', () => {
    const records = runRecords([strictRun(3, 10, { bpm: 35 }), strictRun(2, 9, { bpm: 35, missed: 1 }), strictRun(1, 10, { bpm: 30 })])
    expect(records.map(({ key, value, before }) => [key, value, before])).toEqual([
      ['accuracy', '100%', '90%'],
      ['faults', 'no fault', '1 fault'],
      ['tempo', '35 BPM', '30 BPM'],
    ])
    expect(records[0].title).toBe('Accuracy record at 35 BPM')
    const first = runRecords([strictRun(2, 10), strictRun(1, 6, { missed: 2 })]).find((record) => record.key === 'tempo')
    expect(first).toMatchObject({ value: '30 BPM', before: null })
  })
})

describe('faultBars', () => {
  it('lists the bars each kind of fault fell in, in order, each once', () => {
    const faults = [{ kind: 'wrong', bar: 11 }, { kind: 'wrong', bar: 2 }, { kind: 'wrong', bar: 11 }, { kind: 'late', bar: 4 }, { kind: 'early', bar: 3 }, { kind: 'missed', bar: null }]
    expect(faultBars(faults)).toEqual([
      { key: 'wrong', label: 'Wrong notes', bars: 'bars 3 and 12' },
      { key: 'offClick', label: 'Off the click', bars: 'bars 4 and 5' },
    ])
  })

  it('counts the bars past a handful', () => {
    const faults = [0, 1, 2, 3, 4, 5, 6, 7].map((bar) => ({ kind: 'missed', bar }))
    expect(faultBars(faults)).toEqual([{ key: 'missed', label: 'Missed notes', bars: 'bars 1, 2, 3, 4, 5, 6 and 2 more' }])
  })
})

describe('faultChips', () => {
  const texts = (chips) => chips.map(({ text, detail }) => [text, detail].filter(Boolean).join(' · '))

  it('says what a strict run lost, kind by kind, with where', () => {
    const verdict = { hit: 9, total: 12, offTempoEarly: 0, offTempoLate: 2, missed: 1, wrongNotes: 0 }
    const faults = [{ kind: 'late', bar: 0 }, { kind: 'late', bar: 2 }, { kind: 'missed', bar: 2 }]
    expect(texts(faultChips({ verdict, faults }))).toEqual(['2 off tempo · too late · bars 1 and 3', '1 missed note · bar 3'])
  })

  it('names both sides of the click when a run fell on both', () => {
    const verdict = { hit: 10, total: 12, offTempoEarly: 1, offTempoLate: 1, missed: 0, wrongNotes: 0 }
    expect(texts(faultChips({ verdict }))).toEqual(['2 off tempo · 1 too early, 1 too late'])
  })

  it('lists nothing for a clean run to the click: its rate says it', () => {
    expect(faultChips({ verdict: { hit: 12, total: 12, missed: 0, wrongNotes: 0 } })).toEqual([])
  })

  it('always gives a free run its wrong notes and holes, clean or not', () => {
    const chips = faultChips({ run: { wrongNotes: 2, holes: 0 }, faults: [{ kind: 'wrong', bar: 4 }] })
    expect(texts(chips)).toEqual(['2 wrong notes · bar 5', 'no holes'])
    expect(chips.map((chip) => chip.dot)).toEqual(['wrong', 'clean'])
  })
})

describe('the evolution charts', () => {
  it('plots one point a run, and nothing below two runs', () => {
    expect(resultCharts([run(1, 60_000)])).toEqual([])
    const charts = resultCharts([run(3, 50_000), run(1, 60_000), run(2, 55_000)])
    expect(charts.map((c) => c.title)).toEqual(['Play-time trend'])
    charts.forEach((c) => expect(c.draw(600).match(/<circle/g)).toHaveLength(3))
  })

  it('draws a chart as wide as the place it goes into, and nothing before that place has a width', () => {
    const [chart] = resultCharts([run(2, 50_000), run(1, 60_000)])
    expect(chart.draw(0)).toBe('')
    expect(chart.draw(340)).toContain('viewBox="0 0 340 ')
  })

  it('makes one chart per kind of run and hands, leaving out a group too short to plot', () => {
    const strict = (day, hit) => run(day, 60_000, { strict: { hit, total: 10, bpm: 80 } })
    const charts = playthroughCharts([run(2, 50_000), run(1, 60_000), strict(2, 9), strict(1, 7), run(1, 40_000, { hands: 'left' })])

    expect(charts).toHaveLength(2)
    expect(charts[0].title).not.toBe(charts[1].title)
    expect(charts.every((c) => c.draw(600).startsWith('<svg'))).toBe(true)
  })

  describe('of free runs, in the history and at the end of a piece', () => {
    const bars = (svg, key) => [...svg.matchAll(new RegExp(`chart-bar--${key}"[^>]* height="([^"]*)"`, 'g'))].map((m) => Number(m[1]))

    it('draws the wrong notes and the holes of free runs under their times, a bar per run that has some', () => {
      const svg = playthroughCharts([
        run(3, 50_000, { wrongNotes: 0, holes: 2 }),
        run(2, 55_000, { wrongNotes: 3, holes: 4 }),
        run(1, 60_000, { wrongNotes: 6, holes: 0 }),
      ])[0].draw(600)
      expect(svg).toContain('Wrong notes')
      expect(svg).toContain('Holes')
      expect(bars(svg, 'wrong-notes')).toEqual([28, 14])
      expect(bars(svg, 'holes')).toEqual([28, 14])
      expect(svg).not.toContain('chart-unknown')
    })

    it('marks the runs from before holes were counted as one stretch, not as clean ones', () => {
      const svg = playthroughCharts([run(3, 50_000, { holes: 1 }), run(2, 55_000, { holes: null }), run(1, 60_000, { holes: null })])[0].draw(600)
      expect(svg.match(/class="chart-unknown"/g)).toHaveLength(1)
      expect(bars(svg, 'holes')).toEqual([28])
    })

    it('scales each row of bars from zero to its worst run, one at the least, and says so on the left', () => {
      const scales = (svg) => [...svg.matchAll(/text-anchor="end" class="chart-label">(\d+)</g)].map((m) => m[1])
      const svg = resultCharts([run(3, 50_000, { wrongNotes: 2, holes: 0 }), run(2, 55_000, { wrongNotes: 7, holes: 0 }), run(1, 60_000, { wrongNotes: 3, holes: 0 })])[0].draw(600)
      expect(scales(svg)).toEqual(['7', '1'])
      expect(bars(svg, 'wrong-notes')).toEqual([12, 28, 8])
    })

    it('draws no bars under strict runs', () => {
      const strict = (day, hit) => run(day, 60_000, { strict: { hit, total: 10, bpm: 80 } })
      expect(playthroughCharts([strict(2, 9), strict(1, 7)])[0].draw(600)).not.toContain('chart-bar')
    })
  })

  describe('of strict runs', () => {
    const tempi = (svg) => [...svg.matchAll(/class="chart-label">(\d+)</g)].map((m) => Number(m[1]))
    const steps = (svg) => svg.match(/<path d="([^"]*)" class="chart-step"/)?.[1]

    it('steps the tempo under the hit rate in the history, each step written', () => {
      const svg = playthroughCharts([strictRun(4, 9, { bpm: 31 }), strictRun(3, 10), strictRun(2, 8), strictRun(1, 6)])[0].draw(600)
      expect(svg).toContain('Tempo in BPM')
      // Three runs at 30 along the bottom of the row, then one up at 31.
      expect(steps(svg)).toMatch(/^M56,(\S+) H\S+ V(\S+) H588$/)
      const [, bottom, up] = steps(svg).match(/^M56,(\S+) H\S+ V(\S+) H588$/)
      expect(Number(up)).toBeLessThan(Number(bottom))
      expect(tempi(svg)).toEqual([30, 31])
    })

    it('leaves a step too narrow for its figure unwritten', () => {
      const runs = [strictRun(12, 9, { bpm: 31 }), ...Array.from({ length: 10 }, (_, i) => strictRun(11 - i, 8)), strictRun(1, 6, { bpm: 29 })]
      expect(tempi(playthroughCharts(runs)[0].draw(200))).toEqual([30])
    })

    it('draws a flat line for runs all at one tempo, written once', () => {
      const svg = playthroughCharts([strictRun(2, 9), strictRun(1, 8)])[0].draw(600)
      expect(steps(svg)).toBeDefined()
      expect(tempi(svg)).toEqual([30])
    })

    it('leaves the tempo out at the end of a run, whose ranking is all at one', () => {
      expect(resultCharts([strictRun(2, 9), strictRun(1, 8)])[0].draw(600)).not.toContain('chart-step')
    })
  })
})

describe('the words for a run', () => {
  it('gives a strict run its hit rate at its tempo', () => {
    expect(strictAccuracy({ hit: 9, total: 10 })).toBe(90)
    expect(strictRunLabel({ hit: 9, total: 10, bpm: 80 })).toMatch(/90\s*%.*80/)
  })

  // The rate counts the notes played in tempo: wrong notes struck on top of
  // them leave a run at 100 % that was no clean run (feedback 9337d522).
  it('names what a strict run got wrong, and nothing for a clean one', () => {
    const verdict = { hit: 10, total: 10, bpm: 80, missed: 0, wrongNotes: 0 }
    expect(strictRunLabel(verdict)).not.toContain('(')
    expect(strictRunLabel({ ...verdict, wrongNotes: 2 })).toMatch(/100\s*%.*80.*\(2 /)
    expect(strictRunLabel({ ...verdict, hit: 9, missed: 1, wrongNotes: 1 })).toMatch(/\(1 .*, 1 .*\)$/)
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
