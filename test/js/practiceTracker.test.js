import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  initPracticeTracker,
  computePlaythroughDuration,
  computeSessionDuration,
} from '../../public/js/practiceTracker.js'
import { initStorage } from '../../public/js/storage.js'

describe('practiceTracker', () => {
  let tracker
  let storage

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    storage = initStorage()
    tracker = initPracticeTracker(storage)
    await tracker.init()
  })

  describe('session management', () => {
    it('saves session to storage on end', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      const savedSession = await tracker.endSession()

      const retrieved = await storage.getSession(savedSession.id)
      expect(retrieved.scoreId).toBe('/scores/test.xml')
    })

    it('does not save sessions with no completed measures', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      const savedSession = await tracker.endSession()

      const retrieved = await storage.getSession(savedSession.id)
      expect(retrieved).toBeNull()
    })

    it('toggleMode preserves metadata and saves previous session', async () => {
      tracker.startSession('/scores/test.xml', 'Test Score', 'Test Composer', 'free')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)

      const newSession = await tracker.toggleMode('training')

      expect(newSession.scoreId).toBe('/scores/test.xml')
      expect(newSession.mode).toBe('training')

      // Metadata is stored in aggregates, not in session
      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.totalSessions).toBe(1)
      expect(stats.scoreTitle).toBe('Test Score')
      expect(stats.composer).toBe('Test Composer')
    })
  })

  describe('measure attempts', () => {
    beforeEach(() => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
    })

    it('records wrong notes and marks attempt as dirty', async () => {
      tracker.startMeasureAttempt(0)
      tracker.recordWrongNote()
      tracker.recordWrongNote()

      const attempt = await tracker.endMeasureAttempt()
      expect(attempt.wrongNotes).toBe(2)
      expect(attempt.clean).toBe(false)
    })

    it('groups attempts by measure index', async () => {
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)

      tracker.startMeasureAttempt(1)
      tracker.endMeasureAttempt(true)

      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(false)

      const session = await tracker.endSession()
      const measure0 = session.measures.find((m) => m.sourceMeasureIndex === 0)
      const measure1 = session.measures.find((m) => m.sourceMeasureIndex === 1)

      expect(measure0.attempts).toHaveLength(2)
      expect(measure1.attempts).toHaveLength(1)
    })
  })

  describe('session duration', () => {
    it('calculates duration based only on measure timestamps, not session start time', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')

      // Wait 100ms to simulate user delay before starting to play
      await sleep(100)

      // Play first and second measures
      await playMeasure(0, 50)
      await playMeasure(1, 50)

      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')

      // Duration should be approximately 100ms (two measures of ~50ms each)
      // NOT ~200ms which would include the initial 100ms delay
      expect(stats.totalPracticeTimeMs).toBeGreaterThan(80)
      expect(stats.totalPracticeTimeMs).toBeLessThan(150)
    })

    it('calculates correct duration for daily log', async () => {
      const today = new Date()
      tracker.startSession('/scores/test.xml', 'Test Score', 'Composer', 'training')

      // Wait before starting to play
      await sleep(100)

      await playMeasure(0, 50)

      await tracker.endSession()

      const dailyLog = await tracker.getDailyLog(today)

      expect(dailyLog).toHaveLength(1)
      // Should be ~50ms, not ~150ms
      expect(dailyLog[0].totalPracticeTimeMs).toBeGreaterThan(30)
      expect(dailyLog[0].totalPracticeTimeMs).toBeLessThan(100)
    })
  })

  describe('aggregates', () => {
    it('accumulates sessions and calculates measure statistics', async () => {
      // First session
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      await tracker.endSession()

      // Second session with errors
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.recordWrongNote()
      tracker.endMeasureAttempt(false)
      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.totalSessions).toBe(2)
      expect(stats.measures[0].totalAttempts).toBe(2)
      expect(stats.measures[0].cleanAttempts).toBe(1)
      expect(stats.measures[0].errorRate).toBeCloseTo(0.5)
    })
  })

  describe('score status', () => {
    it('progresses from dechiffrage to perfectionnement after a full playthrough', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')

      // Measure 0: 3 clean attempts (enough for perfectionnement)
      for (let i = 0; i < 3; i++) {
        tracker.startMeasureAttempt(0)
        tracker.endMeasureAttempt(true)
      }

      // Measure 1: 1 clean attempt (not enough)
      tracker.startMeasureAttempt(1)
      tracker.endMeasureAttempt(true)

      tracker.markScoreCompleted()
      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.status).toBe('perfectionnement')
    })

    it('stays dechiffrage if thresholds met but score never completed', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')

      for (let i = 0; i < 3; i++) {
        tracker.startMeasureAttempt(0)
        tracker.endMeasureAttempt(true)
      }
      tracker.startMeasureAttempt(1)
      tracker.endMeasureAttempt(true)

      // No markScoreCompleted()
      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.status).toBe('dechiffrage')
    })

    it('progresses to repertoire once every measure has 10+ clean attempts, 3+ days, and 10+ completions', async () => {
      // 10 sessions × 1 clean attempt/measure = 10 cleanAttempts per measure
      // 10 markScoreCompleted = 10 timesCompleted
      // First 3 sessions land on distinct days to satisfy practiceDays >= 3
      const days = ['2026-01-01', '2026-01-02', '2026-01-03', ...Array(7).fill('2026-01-04')]

      for (const day of days) {
        tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free')

        for (const m of [0, 1]) {
          tracker.startMeasureAttempt(m)
          tracker.endMeasureAttempt(true)
        }

        tracker.markScoreCompleted()
        const session = await tracker.endSession()

        session.startedAt = `${day}T10:00:00.000Z`
        await storage.saveSession(session)

        const agg = await storage.getAggregate('/scores/test.xml')
        if (agg && !agg.practiceDays.includes(day)) {
          agg.practiceDays.push(day)
          await storage.saveAggregate(agg)
        }
      }

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.status).toBe('repertoire')
    })

    it('stays perfectionnement when only one session has played the piece (mastery alone is not enough)', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free')

      for (const m of [0, 1]) {
        for (let i = 0; i < 10; i++) {
          tracker.startMeasureAttempt(m)
          tracker.endMeasureAttempt(true)
        }
      }

      tracker.markScoreCompleted()
      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.status).toBe('perfectionnement')
    })
  })

  describe('analyzeMeasuresFromSession', () => {
    it('returns empty array for null session', () => {
      const result = tracker.analyzeMeasuresFromSession(null)
      expect(result).toEqual([])
    })

    it('returns empty array for session with no measures', () => {
      const result = tracker.analyzeMeasuresFromSession({ measures: [] })
      expect(result).toEqual([])
    })

    it('excludes measures with no wrong notes', () => {
      const session = {
        measures: [
          { sourceMeasureIndex: 0, attempts: [{ wrongNotes: 0, durationMs: 100 }] },
          { sourceMeasureIndex: 1, attempts: [{ wrongNotes: 2, durationMs: 100 }] },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session)
      expect(result).toHaveLength(1)
      expect(result[0].sourceMeasureIndex).toBe(1)
    })

    it('sorts by total wrong notes descending', () => {
      const session = {
        measures: [
          { sourceMeasureIndex: 0, attempts: [{ wrongNotes: 1, durationMs: 100 }] },
          { sourceMeasureIndex: 1, attempts: [{ wrongNotes: 3, durationMs: 100 }] },
          { sourceMeasureIndex: 2, attempts: [{ wrongNotes: 2, durationMs: 100 }] },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session)
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1, 2, 0])
    })

    it('uses duration as secondary sort criterion', () => {
      const session = {
        measures: [
          { sourceMeasureIndex: 0, attempts: [{ wrongNotes: 2, durationMs: 100 }] },
          { sourceMeasureIndex: 1, attempts: [{ wrongNotes: 2, durationMs: 300 }] },
          { sourceMeasureIndex: 2, attempts: [{ wrongNotes: 2, durationMs: 200 }] },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session)
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1, 2, 0])
    })

    it('sums wrong notes across multiple attempts', () => {
      const session = {
        measures: [
          {
            sourceMeasureIndex: 0,
            attempts: [
              { wrongNotes: 1, durationMs: 100 },
              { wrongNotes: 2, durationMs: 100 },
            ],
          },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session)
      expect(result[0].wrongNotes).toBe(3)
    })

    it('uses last attempt duration', () => {
      const session = {
        measures: [
          {
            sourceMeasureIndex: 0,
            attempts: [
              { wrongNotes: 1, durationMs: 100 },
              { wrongNotes: 1, durationMs: 200 },
            ],
          },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session)
      expect(result[0].durationMs).toBe(200)
    })

    it('respects limit parameter', () => {
      const session = {
        measures: [
          { sourceMeasureIndex: 0, attempts: [{ wrongNotes: 3, durationMs: 100 }] },
          { sourceMeasureIndex: 1, attempts: [{ wrongNotes: 2, durationMs: 100 }] },
          { sourceMeasureIndex: 2, attempts: [{ wrongNotes: 1, durationMs: 100 }] },
        ],
      }
      const result = tracker.analyzeMeasuresFromSession(session, 2)
      expect(result).toHaveLength(2)
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([0, 1])
    })
  })

  describe('daily log', () => {
    it('returns practiced scores for today', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      await tracker.endSession()

      const log = await tracker.getDailyLog(new Date())

      expect(log).toHaveLength(1)
      expect(log[0].scoreId).toBe('/scores/test.xml')
      expect(log[0].measuresWorked).toContain(0)
    })

    it('getDailyLogs matches per-day reads, in a single pass over the store', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      await tracker.endSession()

      const today = new Date()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const dates = [today, yesterday]

      const perDay = [await tracker.getDailyLog(today), await tracker.getDailyLog(yesterday)]

      let reads = 0
      const getSessions = storage.getSessions.bind(storage)
      storage.getSessions = (...args) => {
        reads++
        return getSessions(...args)
      }
      const batched = await tracker.getDailyLogs(dates)
      storage.getSessions = getSessions

      expect(batched).toEqual(perDay)
      expect(batched[0]).toHaveLength(1)
      expect(batched[1]).toHaveLength(0)
      // The journal asks for a fortnight; that must stay one read, not fourteen.
      expect(reads).toBe(1)
    })

    it('counts timesPlayedInFull across multiple sessions', async () => {
      // First session: complete playthrough
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      await playMeasure(0)
      await playMeasure(1)
      tracker.markScoreCompleted()
      await tracker.endSession()

      // Second session: another complete playthrough
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      await playMeasure(0)
      await playMeasure(1)
      tracker.markScoreCompleted()
      await tracker.endSession()

      const log = await tracker.getDailyLog(new Date())

      expect(log).toHaveLength(1)
      expect(log[0].timesPlayedInFull).toBe(2)
    })

    it('returns timesPlayedInFull=0 when score is not fully played', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training', 5)

      // Only play 3 of 5 measures
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      tracker.startMeasureAttempt(1)
      tracker.endMeasureAttempt(true)
      tracker.startMeasureAttempt(2)
      tracker.endMeasureAttempt(true)

      await tracker.endSession()

      const log = await tracker.getDailyLog(new Date())

      expect(log).toHaveLength(1)
      expect(log[0].timesPlayedInFull).toBe(0)
    })

    it('counts playthrough when markScoreCompleted is called after restart', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 3)

      // Start playing measures 0, 1 (incomplete)
      await playMeasure(0, 5)
      await playMeasure(1, 5)

      // Restart from beginning and play all measures
      await playMeasure(0, 5)
      await playMeasure(1, 5)
      await playMeasure(2, 5)

      tracker.markScoreCompleted()
      await tracker.endSession()

      const log = await tracker.getDailyLog(new Date())

      expect(log).toHaveLength(1)
      expect(log[0].timesPlayedInFull).toBe(1)
    })

    it('counts playthrough with repeats when markScoreCompleted is called', async () => {
      // Simulate a score with repeats (like Fur Elise)
      // Source measures: 0-4, but with repeat: 0,1,2,0,1,3,4
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 5)

      // First section: 0, 1, 2
      await playMeasure(0, 5)
      await playMeasure(1, 5)
      await playMeasure(2, 5)

      // Repeat: back to 0, 1 (this would break sequential detection)
      await playMeasure(0, 5)
      await playMeasure(1, 5)

      // Continue with 3, 4
      await playMeasure(3, 5)
      await playMeasure(4, 5)

      // Mark as completed (this is what onScoreCompleted does)
      tracker.markScoreCompleted()
      await tracker.endSession()

      const log = await tracker.getDailyLog(new Date())

      expect(log).toHaveLength(1)
      // Should count as 1 playthrough because markScoreCompleted was called
      expect(log[0].timesPlayedInFull).toBe(1)
    })

    it('playthrough duration excludes time before restarting from measure 0', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 3)

      // Play measures 1, 2 first (simulates clicking on measure 1)
      await playMeasure(1, 50)
      await playMeasure(2, 50)

      // Now restart from measure 0 (simulates clicking on measure 0)
      tracker.restartPlaythrough()
      await playMeasure(0, 30)
      await playMeasure(1, 30)
      await playMeasure(2, 30)

      tracker.markScoreCompleted()
      await tracker.endSession()

      const history = await tracker.getScoreHistory('/scores/test.xml')

      expect(history[0].fullPlaythroughs).toHaveLength(1)
      // Duration should be ~90ms (from restart to completion)
      // NOT ~190ms (which would include the initial measures 1, 2)
      expect(history[0].fullPlaythroughs[0].durationMs).toBeGreaterThan(70)
      expect(history[0].fullPlaythroughs[0].durationMs).toBeLessThan(150)
    })

    it('consecutive playthroughs have correct independent timings', async () => {
      // First playthrough: slow (~150ms)
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      await playMeasure(0, 75)
      await playMeasure(1, 75)
      tracker.markScoreCompleted()
      await tracker.endSession()

      // Second playthrough: fast (~60ms)
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      await playMeasure(0, 30)
      await playMeasure(1, 30)
      tracker.markScoreCompleted()
      await tracker.endSession()

      const history = await tracker.getScoreHistory('/scores/test.xml')

      // Both playthroughs are on the same day, so 1 history entry with 2 playthroughs
      expect(history).toHaveLength(1)
      expect(history[0].fullPlaythroughs).toHaveLength(2)

      // Playthroughs are sorted by most recent first
      const [secondPlaythrough, firstPlaythrough] = history[0].fullPlaythroughs

      // First playthrough should be ~150ms
      expect(firstPlaythrough.durationMs).toBeGreaterThan(120)
      expect(firstPlaythrough.durationMs).toBeLessThan(200)

      // Second playthrough should be ~60ms (not affected by first)
      expect(secondPlaythrough.durationMs).toBeGreaterThan(40)
      expect(secondPlaythrough.durationMs).toBeLessThan(100)
    })
  })

  describe('getScoreHistory', () => {
    it('returns history for specific score only, with correct data', async () => {
      await playSession('/scores/test1.xml', [0, 1], 'training', 2, true)
      await playSession('/scores/test2.xml', [0])

      const history = await tracker.getScoreHistory('/scores/test1.xml')

      expect(history).toHaveLength(1)
      expect(history[0].measuresWorked).toEqual([0, 1])
      expect(history[0].measuresReinforced).toEqual([0, 1])
      expect(history[0].timesPlayedInFull).toBe(1)
    })

    it('calculates playthrough duration as end of last measure minus start of first', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)

      await playMeasure(0, 50)
      await playMeasure(1, 50)

      tracker.markScoreCompleted()
      await tracker.endSession()

      const history = await tracker.getScoreHistory('/scores/test.xml')

      expect(history[0].fullPlaythroughs).toHaveLength(1)
      // Duration should be ~100ms (time from start of measure 0 to end of measure 1)
      expect(history[0].fullPlaythroughs[0].durationMs).toBeGreaterThan(80)
      expect(history[0].fullPlaythroughs[0].durationMs).toBeLessThan(200)
    })

    it('does not track measuresReinforced for free mode', async () => {
      await playSession('/scores/test.xml', [0], 'free')

      const history = await tracker.getScoreHistory('/scores/test.xml')

      expect(history[0].measuresWorked).toEqual([0])
      expect(history[0].measuresReinforced).toEqual([])
    })
  })

  const BASE = new Date('2026-06-10T10:00:00.000Z').getTime()

  // Lay out {dur, gapBefore} segments on a timeline starting at BASE: the cursor
  // advances by each gap, then by each measure duration. Both duration functions
  // now share one normalization, so their fixtures share one builder.
  function buildMeasures(segments) {
    let cursor = BASE
    const measures = segments.map(({ dur, gapBefore = 0 }, i) => {
      cursor += gapBefore
      const startedAt = new Date(cursor).toISOString()
      cursor += dur
      return { sourceMeasureIndex: i, attempts: [{ startedAt, durationMs: dur, clean: true }] }
    })
    return { measures, endedAt: cursor }
  }

  describe('computePlaythroughDuration (interruption normalization)', () => {
    // completedAt sits right after the last measure.
    function buildPlaythrough(segments) {
      const { measures, endedAt } = buildMeasures(segments)
      return {
        playthroughStartedAt: new Date(BASE).toISOString(),
        completedAt: new Date(endedAt).toISOString(),
        measures,
      }
    }

    it('leaves an uninterrupted playthrough unchanged (equals wall-clock)', () => {
      const session = buildPlaythrough([
        { dur: 5000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
      ])
      // 5×5000 measures + 4×1000 gaps = 29000
      expect(computePlaythroughDuration(session)).toBe(29000)
    })

    it('does not penalize slow-but-continuous playing', () => {
      // Slow measures (12s) and slowish-but-normal gaps (3s): nothing clamped.
      const session = buildPlaythrough([
        { dur: 12000 },
        { dur: 12000, gapBefore: 3000 },
        { dur: 12000, gapBefore: 3000 },
        { dur: 12000, gapBefore: 3000 },
      ])
      const raw =
        new Date(session.completedAt).getTime() -
        new Date(session.playthroughStartedAt).getTime()
      expect(computePlaythroughDuration(session)).toBe(raw)
    })

    it('clamps an interruption that lands inside a measure', () => {
      // Measure 2 ballooned to 200s (interrupted mid-measure before completing).
      const session = buildPlaythrough([
        { dur: 5000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 200000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
      ])
      // Aberrant measure → longest normal measure (5000). Same as uninterrupted.
      expect(computePlaythroughDuration(session)).toBe(29000)
    })

    it('clamps an interruption that lands between two measures', () => {
      // A 5-minute pause before measure 3 (phone call after finishing measure 2).
      const session = buildPlaythrough([
        { dur: 5000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 300000 },
        { dur: 5000, gapBefore: 1000 },
      ])
      // Aberrant gap → median normal gap (1000). Same as uninterrupted.
      expect(computePlaythroughDuration(session)).toBe(29000)
    })

    it('falls back to raw duration when attempts lack timing', () => {
      const session = {
        playthroughStartedAt: new Date(BASE).toISOString(),
        completedAt: new Date(BASE + 42000).toISOString(),
        measures: [{ sourceMeasureIndex: 0, attempts: [{ clean: true }] }],
      }
      expect(computePlaythroughDuration(session)).toBe(42000)
    })
  })

  describe('computeSessionDuration (practice time credited to a session)', () => {
    // A session has no playthrough window: the duration comes from the attempts.
    function buildSession(segments) {
      return { startedAt: new Date(BASE).toISOString(), measures: buildMeasures(segments).measures }
    }

    it('spans first attempt to last when nothing is aberrant', () => {
      const session = buildSession([
        { dur: 5000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
      ])
      // 4×5000 + 3×1000 = 23000, i.e. the raw span.
      expect(computeSessionDuration(session)).toBe(23000)
    })

    it('is zero without any attempt', () => {
      expect(computeSessionDuration({ measures: [] })).toBe(0)
      expect(computeSessionDuration({})).toBe(0)
    })

    it('discounts a score left open mid-measure', () => {
      // The real case behind this: one attempt ran 79 minutes on measure 0
      // while the score sat open, and the journal credited the whole of it —
      // ten minutes of practice reported as 1h33.
      const session = buildSession([
        { dur: 5000 },
        { dur: 4736000, gapBefore: 1000 }, // walked away
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 1000 },
      ])
      // The marathon attempt is replaced by the longest normal measure (5000),
      // leaving the same 23000 as an uninterrupted session.
      expect(computeSessionDuration(session)).toBe(23000)
    })

    it('discounts a pause taken between two measures', () => {
      const session = buildSession([
        { dur: 5000 },
        { dur: 5000, gapBefore: 1000 },
        { dur: 5000, gapBefore: 3_600_000 }, // walked away
        { dur: 5000, gapBefore: 1000 },
      ])
      expect(computeSessionDuration(session)).toBe(23000)
    })

    it('does not penalize slow-but-continuous practice', () => {
      const session = buildSession([
        { dur: 12000 },
        { dur: 12000, gapBefore: 3000 },
        { dur: 12000, gapBefore: 3000 },
      ])
      expect(computeSessionDuration(session)).toBe(42000)
    })
  })

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function playMeasure(measureIndex, delayMs = 0) {
    tracker.startMeasureAttempt(measureIndex)
    if (delayMs > 0) await sleep(delayMs)
    tracker.endMeasureAttempt(true)
  }

  async function playSession(scoreId, measures, mode = 'training', totalMeasures = null, markComplete = false) {
    tracker.startSession(scoreId, 'Test', 'Composer', mode, totalMeasures)
    for (const m of measures) {
      await playMeasure(m)
    }
    if (markComplete) tracker.markScoreCompleted()
    await tracker.endSession()
  }

  describe('getAllScores', () => {
    it('returns all practiced scores', async () => {
      tracker.startSession('/scores/test1.xml', 'Test 1', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      await tracker.endSession()

      tracker.startSession('/scores/test2.xml', 'Test 2', 'Composer', 'training')
      tracker.startMeasureAttempt(0)
      tracker.endMeasureAttempt(true)
      await tracker.endSession()

      const allScores = await tracker.getAllScores()
      expect(allScores).toHaveLength(2)
    })
  })
})
