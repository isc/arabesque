import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  initPracticeTracker,
  computePlaythroughDuration,
  computeSessionDuration,
} from '../../public/js/practiceTracker.js'
import { playthroughHands, playthroughGroups } from '../../public/js/hands.js'
import { initStorage } from '../../public/js/storage.js'

describe('practiceTracker', () => {
  let tracker
  let storage

  const BASE = new Date('2026-06-10T10:00:00.000Z').getTime()

  // The tracker times every attempt off the wall clock, so the suite runs on a
  // frozen one: nothing moves unless a test moves it, and a duration is then
  // exactly the milliseconds it was given rather than that plus whatever the
  // scheduler cost. Only Date is faked — fake-indexeddb runs its transactions
  // on the real timers.
  let clock

  function advanceClock(ms) {
    clock += ms
    vi.setSystemTime(clock)
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    clock = BASE
    vi.setSystemTime(clock)
    indexedDB = new IDBFactory()
    storage = initStorage()
    tracker = initPracticeTracker(storage)
    await tracker.init()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  // A strict run is handed over once it is over, each measure already timed at
  // the tempo it was played at, and it must reach the journal like any other
  // practice: measures worked, practice time, run played in full — and, since
  // its time is the metronome's, the verdict the engine gave it.
  describe('strict runs', () => {
    const VERDICT = { bpm: 120, total: 6, hit: 5, offTempoEarly: 0, offTempoLate: 1, missed: 0, wrongNotes: 1 }

    // One clock reading for the whole run: two of them, a millisecond apart,
    // would put 4001 in the journal.
    function strictRun() {
      const runStartedAt = Date.now() - 4000
      const startedAt = new Date(runStartedAt).toISOString()
      return {
        verdict: VERDICT,
        fromTheTop: true,
        completed: true,
        measures: [
          { sourceMeasureIndex: 0, startedAt, durationMs: 2000, hands: 'both' },
          {
            sourceMeasureIndex: 1,
            startedAt: new Date(runStartedAt + 2000).toISOString(),
            durationMs: 2000,
            wrongNotes: 1,
            clean: false,
            hands: 'both',
          },
        ],
      }
    }

    async function playStrict(run = strictRun()) {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'strict', 2)
      tracker.recordStrictRun(run)
      return tracker.endSession()
    }

    it('puts the run in the daily log with its verdict', async () => {
      await playStrict()

      const [entry] = await tracker.getDailyLog(new Date())
      expect(entry.measuresWorked).toEqual([0, 1])
      expect(entry.totalPracticeTimeMs).toBe(4000)
      expect(entry.timesPlayedInFull).toBe(1)
      expect(entry.fullPlaythroughs[0].strict).toEqual(VERDICT)
    })

    it('does not file a run stopped mid-piece as a playthrough', async () => {
      await playStrict({ ...strictRun(), fromTheTop: false, completed: false })

      const [entry] = await tracker.getDailyLog(new Date())
      expect(entry.measuresWorked).toEqual([0, 1])
      expect(entry.fullPlaythroughs).toEqual([])
    })

    it('lists strict runs apart from free ones', async () => {
      await playStrict()
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      await playMeasure(0, 50)
      await playMeasure(1, 50)
      tracker.markScoreCompleted()
      await tracker.endSession()

      const [day] = await tracker.getScoreHistory('/scores/test.xml')
      expect(day.timesPlayedInFull).toBe(2)
      const groups = playthroughGroups(day.fullPlaythroughs)
      expect(groups.map((g) => g.key)).toEqual(['free-both', 'strict-both'])
      expect(groups[0].playthroughs[0].strict).toBeNull()
      expect(groups[1].playthroughs[0].strict).toEqual(VERDICT)
    })
  })

  describe('session duration', () => {
    it('calculates duration based only on measure timestamps, not session start time', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'training')

      // 100ms of user delay before starting to play
      advanceClock(100)

      // Play first and second measures
      await playMeasure(0, 50)
      await playMeasure(1, 50)

      await tracker.endSession()

      const stats = await tracker.getScoreStats('/scores/test.xml')

      // Two measures of 50ms, NOT 200ms — the initial 100ms delay is excluded.
      expect(stats.totalPracticeTimeMs).toBe(100)
    })

    it('calculates correct duration for daily log', async () => {
      const today = new Date()
      tracker.startSession('/scores/test.xml', 'Test Score', 'Composer', 'training')

      // Wait before starting to play
      advanceClock(100)

      await playMeasure(0, 50)

      await tracker.endSession()

      const dailyLog = await tracker.getDailyLog(today)

      expect(dailyLog).toHaveLength(1)
      // The measure alone: 50ms, not 150ms.
      expect(dailyLog[0].totalPracticeTimeMs).toBe(50)
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

  describe('the hands a run was played with', () => {
    const BOTH = { right: true, left: true }
    const RIGHT = { right: true, left: false }
    const LEFT = { right: false, left: true }

    // A run through a two-bar score, one hand selection per bar.
    async function playThrough(...handsPerMeasure) {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 2)
      for (const [index, hands] of handsPerMeasure.entries()) {
        await playMeasure(index, 0, hands)
      }
      tracker.markScoreCompleted()
      return tracker.endSession()
    }

    it('stores the ticked hands on every attempt', async () => {
      const session = await playThrough(RIGHT, { right: false, left: false })

      expect(session.measures.map((m) => m.attempts[0].hands)).toEqual(['right', 'none'])
    })

    it('reads an attempt recorded before hands were tracked as two-handed', () => {
      expect(playthroughHands([{ clean: true }, { clean: false }])).toBe('both')
    })

    it('does not count a one-hand run as the piece played in full', async () => {
      await playThrough(RIGHT, RIGHT)

      const stats = await tracker.getScoreStats('/scores/test.xml')
      expect(stats.timesCompleted).toBe(0)
      expect(stats.timesCompletedOneHand).toBe(1)
      expect(stats.lastCompletedAt).toBeUndefined()
      expect(stats.status).toBe('dechiffrage')
    })

    it("keeps a one-hand run out of the calendar's playthroughs", async () => {
      await playThrough(RIGHT, RIGHT)

      const calendar = await tracker.getPracticeCalendar()
      expect([...calendar.values()][0].timesPlayedInFull).toBe(0)
    })

    it('lists a one-hand run apart from a two-hand one', async () => {
      await playThrough(RIGHT, RIGHT)
      await playThrough(BOTH, BOTH)
      await playThrough(LEFT, LEFT)

      const [day] = await tracker.getScoreHistory('/scores/test.xml')
      expect(day.timesPlayedInFull).toBe(1)
      expect(playthroughGroups(day.fullPlaythroughs).map((g) => g.hands)).toEqual(['both', 'right', 'left'])
    })

    it('only calls a run two-handed when both hands were on throughout', async () => {
      await playThrough(BOTH, RIGHT)

      const [day] = await tracker.getScoreHistory('/scores/test.xml')
      expect(day.fullPlaythroughs[0].hands).toBe('mixed')
      expect(day.timesPlayedInFull).toBe(0)
    })
  })

  describe('measures to reinforce', () => {
    // Sessions as the ranking takes them: oldest first, one entry per measure.
    const session = (measures) => ({
      measures: Object.entries(measures).map(([index, attempts]) => ({
        sourceMeasureIndex: Number(index),
        attempts: attempts.map(([wrongNotes, durationMs = 100]) => ({
          wrongNotes,
          durationMs,
          clean: wrongNotes === 0,
        })),
      })),
    })

    it('returns nothing without sessions', () => {
      expect(tracker.rankMeasuresToReinforce([])).toEqual([])
    })

    it('excludes measures played without a fumble', () => {
      const result = tracker.rankMeasuresToReinforce([session({ 0: [[0]], 1: [[2]] })])
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1])
    })

    it('drops a measure once it has been played cleanly three times in a row', () => {
      const fumbled = [session({ 0: [[2]] })]
      expect(tracker.rankMeasuresToReinforce([...fumbled, session({ 0: [[0], [0]] })])).toHaveLength(1)
      expect(tracker.rankMeasuresToReinforce([...fumbled, session({ 0: [[0], [0], [0]] })])).toEqual([])
    })

    it('sorts by wrong notes, then by duration', () => {
      const result = tracker.rankMeasuresToReinforce([
        session({ 0: [[2, 100]], 1: [[3, 100]], 2: [[2, 300]] }),
      ])
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1, 2, 0])
    })

    it('sums wrong notes across sessions and keeps the last duration', () => {
      const result = tracker.rankMeasuresToReinforce([
        session({ 0: [[1, 100]] }),
        session({ 0: [[2, 300]] }),
      ])
      expect(result[0]).toMatchObject({ wrongNotes: 3, durationMs: 300 })
    })

    it('respects the limit', () => {
      const result = tracker.rankMeasuresToReinforce([session({ 0: [[3]], 1: [[2]], 2: [[1]] })], 2)
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([0, 1])
    })

    it('flags a measure whose error rate stops falling, and ranks it first', () => {
      const stagnating = { 0: [[1]] } // fumbled in every session
      const improving = { 1: [[4]] } // heavier, but on the mend below
      const result = tracker.rankMeasuresToReinforce([
        session({ ...stagnating, ...improving }),
        session({ ...stagnating, 1: [[1], [0]] }),
        session({ ...stagnating, 1: [[0]] }),
      ])
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([0, 1])
      expect(result.map((m) => m.stagnant)).toEqual([true, false])
    })

    it('needs three sessions before calling a measure stagnant', () => {
      const twoSessions = [session({ 0: [[1]] }), session({ 0: [[1]] })]
      expect(tracker.rankMeasuresToReinforce(twoSessions)[0].stagnant).toBe(false)
    })

    it('suggests measures from the session under way, before any playthrough', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free')
      tracker.startMeasureAttempt(3)
      tracker.recordWrongNote()
      await tracker.endMeasureAttempt()

      const result = await tracker.getMeasuresToReinforce('/scores/test.xml')
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([3])
    })

    it('keeps a measure fumbled in an earlier session', async () => {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free')
      tracker.startMeasureAttempt(2)
      tracker.recordWrongNote()
      await tracker.endMeasureAttempt()
      await tracker.endSession()

      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free')
      const result = await tracker.getMeasuresToReinforce('/scores/test.xml')
      expect(result.map((m) => m.sourceMeasureIndex)).toEqual([2])
    })

    it('ignores other scores', async () => {
      tracker.startSession('/scores/other.xml', 'Other', 'Composer', 'free')
      tracker.startMeasureAttempt(0)
      tracker.recordWrongNote()
      await tracker.endMeasureAttempt()

      expect(await tracker.getMeasuresToReinforce('/scores/test.xml')).toEqual([])
      expect(await tracker.getMeasuresToReinforce(null)).toEqual([])
    })
  })

  describe('sessions interrupted by a page teardown', () => {
    // The tracker reaches for localStorage only through the stash; the suite
    // runs in node, so it needs one.
    beforeEach(() => {
      const store = new Map()
      globalThis.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      }
    })

    // What a page teardown looks like: measures played and saved incrementally,
    // then the snapshot, then endSession() never getting to commit.
    async function interruptedSession() {
      tracker.startSession('/scores/test.xml', 'Test', 'Composer', 'free', 4)
      tracker.startMeasureAttempt(0)
      await tracker.endMeasureAttempt(true)
      await storage.saveSession(tracker.getCurrentSession())
      const id = tracker.getCurrentSession().id
      tracker.stashPendingSession()
      return id
    }

    it('closes and credits the session on the next load', async () => {
      const id = await interruptedSession()
      expect((await storage.getSession(id)).endedAt).toBeNull()
      // endMeasureAttempt() has written a title-only aggregate row; what it has
      // never done is credit the session itself.
      expect((await storage.getAggregate('/scores/test.xml'))?.totalSessions ?? 0).toBe(0)

      const revived = initPracticeTracker(storage)
      await revived.init()

      expect((await storage.getSession(id)).endedAt).toBeTruthy()
      const agg = await storage.getAggregate('/scores/test.xml')
      expect(agg.totalSessions).toBe(1)
      expect(agg.scoreTitle).toBe('Test')
      expect(agg.measures['0'].totalAttempts).toBe(1)
    })

    it('does not credit twice when the session did commit after all', async () => {
      await interruptedSession()
      const stash = localStorage.getItem('arabesque:pending-session')
      // endSession() won the race, then the page died before it could clear the
      // stash — so the snapshot is still there on the next load.
      await tracker.endSession()
      localStorage.setItem('arabesque:pending-session', stash)
      const before = await storage.getAggregate('/scores/test.xml')
      expect(before.totalSessions).toBe(1)

      const revived = initPracticeTracker(storage)
      await revived.init()

      const after = await storage.getAggregate('/scores/test.xml')
      expect(after.totalSessions).toBe(before.totalSessions)
      expect(after.totalPracticeTimeMs).toBe(before.totalPracticeTimeMs)
    })

    it('replays the snapshot only once', async () => {
      await interruptedSession()

      await initPracticeTracker(storage).init()
      await initPracticeTracker(storage).init()

      expect((await storage.getAggregate('/scores/test.xml')).totalSessions).toBe(1)
    })

    it('keeps a snapshot when a different session ends', async () => {
      await interruptedSession()
      const stash = localStorage.getItem('arabesque:pending-session')

      // Another session runs to a clean close — a new score opened on the same
      // page, say. It must not consume the stranded one's snapshot.
      tracker.startSession('/scores/other.xml', 'Other', 'Composer', 'free', 4)
      tracker.startMeasureAttempt(0)
      await tracker.endMeasureAttempt(true)
      await tracker.endSession()

      expect(localStorage.getItem('arabesque:pending-session')).toBe(stash)

      await initPracticeTracker(storage).init()
      expect((await storage.getAggregate('/scores/test.xml')).totalSessions).toBe(1)
    })

    // A session stranded long ago, as left behind by a version with no
    // snapshots: measures played and saved, endedAt never stamped.
    async function strandedSession(id, hoursAgo = 24) {
      const started = new Date(Date.now() - hoursAgo * 3600e3)
      await storage.saveSession({
        id, scoreId: '/scores/old.xml', mode: 'free', totalMeasures: 4,
        startedAt: started.toISOString(), playthroughStartedAt: null, endedAt: null,
        measures: [{ sourceMeasureIndex: 0, attempts: [
          { startedAt: started.toISOString(), durationMs: 5000, wrongNotes: 0, clean: true }] }],
      })
      return started
    }

    it('closes sessions left with no endedAt by an older version', async () => {
      const started = await strandedSession('old-1')

      await initPracticeTracker(storage).init()

      const closed = await storage.getSession('old-1')
      // Closed when the player actually stopped, not when the repair ran.
      expect(closed.endedAt).toBe(new Date(started.getTime() + 5000).toISOString())
      const agg = await storage.getAggregate('/scores/old.xml')
      expect(agg.totalSessions).toBe(1)
      expect(agg.measures['0'].totalAttempts).toBe(1)
    })

    it('repairs stranded sessions only once', async () => {
      await strandedSession('old-1')

      await initPracticeTracker(storage).init()
      const after = await storage.getAggregate('/scores/old.xml')
      // A second load with the marker in place, and a third with it removed:
      // the endedAt filter is what makes the repair safe to re-run.
      await initPracticeTracker(storage).init()
      localStorage.removeItem('arabesque:stranded-sessions-closed')
      await initPracticeTracker(storage).init()

      const again = await storage.getAggregate('/scores/old.xml')
      expect(again.totalSessions).toBe(after.totalSessions)
      expect(again.totalPracticeTimeMs).toBe(after.totalPracticeTimeMs)
    })

    it('leaves a session that is still being played alone', async () => {
      // Recent activity is what says "in progress", here or in another tab —
      // closing it would credit it now and again when its own tab finishes.
      await strandedSession('live-elsewhere', 0)

      await initPracticeTracker(storage).init()

      expect((await storage.getSession('live-elsewhere')).endedAt).toBeNull()
      expect((await storage.getAggregate('/scores/old.xml'))?.totalSessions ?? 0).toBe(0)
    })

    it('ignores a snapshot the page cleared on its way back', async () => {
      await interruptedSession()
      tracker.clearPendingSession()

      await initPracticeTracker(storage).init()

      expect((await storage.getAggregate('/scores/test.xml'))?.totalSessions ?? 0).toBe(0)
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

      // Now restart from measure 0 (simulates clicking on measure 0), a moment
      // after measure 2 ended — an attempt finishing on the very millisecond a
      // playthrough starts belongs to it.
      advanceClock(10)
      tracker.restartPlaythrough()
      await playMeasure(0, 30)
      await playMeasure(1, 30)
      await playMeasure(2, 30)

      tracker.markScoreCompleted()
      await tracker.endSession()

      const history = await tracker.getScoreHistory('/scores/test.xml')

      expect(history[0].fullPlaythroughs).toHaveLength(1)
      // 90ms, from restart to completion — NOT 190ms, which would include the
      // initial measures 1, 2.
      expect(history[0].fullPlaythroughs[0].durationMs).toBe(90)
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

      expect(firstPlaythrough.durationMs).toBe(150)
      // The second one is timed on its own, not from the first.
      expect(secondPlaythrough.durationMs).toBe(60)
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
      // From the start of measure 0 to the end of measure 1.
      expect(history[0].fullPlaythroughs[0].durationMs).toBe(100)
    })

    it('does not track measuresReinforced for free mode', async () => {
      await playSession('/scores/test.xml', [0], 'free')

      const history = await tracker.getScoreHistory('/scores/test.xml')

      expect(history[0].measuresWorked).toEqual([0])
      expect(history[0].measuresReinforced).toEqual([])
    })
  })

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

  async function playMeasure(measureIndex, delayMs = 0, activeHands = undefined) {
    tracker.startMeasureAttempt(measureIndex, measureIndex === 0, activeHands)
    advanceClock(delayMs)
    await tracker.endMeasureAttempt(true)
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
