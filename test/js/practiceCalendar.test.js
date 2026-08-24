import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { initPracticeTracker, practiceStreaks, shiftDayKey } from '../../public/js/practiceTracker.js'
import { initStorage } from '../../public/js/storage.js'
import { levelFor } from '../../public/js/practice.js'

// A session whose measures make `minutes` of continuous playing on `date`.
function sessionOn(date, minutes, { id = date, scoreId = '/scores/a.xml', completed = false } = {}) {
  const start = new Date(`${date}T19:00:00`)
  const durationMs = minutes * 60 * 1000
  return {
    id,
    scoreId,
    totalMeasures: 1,
    mode: 'free',
    startedAt: start.toISOString(),
    playthroughStartedAt: start.toISOString(),
    completedAt: completed ? new Date(start.getTime() + durationMs).toISOString() : null,
    endedAt: new Date(start.getTime() + durationMs).toISOString(),
    measures: [
      { sourceMeasureIndex: 0, attempts: [{ startedAt: start.toISOString(), durationMs, wrongNotes: 0, clean: true }] },
    ],
  }
}

describe('practice calendar', () => {
  let tracker
  let storage

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    storage = initStorage()
    tracker = initPracticeTracker(storage)
    await tracker.init()
  })

  describe('getPracticeCalendar', () => {
    it('totals a day across its sessions and scores', async () => {
      await storage.saveSession(sessionOn('2026-03-04', 10, { id: 'a' }))
      await storage.saveSession(sessionOn('2026-03-04', 5, { id: 'b', scoreId: '/scores/b.xml', completed: true }))
      await storage.saveSession(sessionOn('2026-03-06', 20, { id: 'c' }))

      const calendar = await tracker.getPracticeCalendar()

      expect(calendar.get('2026-03-04')).toEqual({
        date: '2026-03-04',
        practiceTimeMs: 15 * 60 * 1000,
        sessions: 2,
        scores: 2,
        timesPlayedInFull: 1,
      })
      expect(calendar.get('2026-03-06').practiceTimeMs).toBe(20 * 60 * 1000)
    })

    it('leaves days with no practice out entirely', async () => {
      await storage.saveSession(sessionOn('2026-03-04', 10))

      const calendar = await tracker.getPracticeCalendar()

      expect(calendar.size).toBe(1)
      expect(calendar.has('2026-03-05')).toBe(false)
    })

    it('keys a late-night session to the day it was played, not to the UTC day', async () => {
      // 00:30 local: a UTC-based key would file this under the previous day in
      // any timezone ahead of UTC.
      const start = new Date('2026-03-04T00:30:00')
      await storage.saveSession({
        ...sessionOn('2026-03-04', 10),
        startedAt: start.toISOString(),
      })

      const calendar = await tracker.getPracticeCalendar()

      expect([...calendar.keys()]).toEqual(['2026-03-04'])
    })

    it('reads the whole history in a single pass over the store', async () => {
      for (const day of ['2026-03-01', '2026-03-02', '2026-03-03']) {
        await storage.saveSession(sessionOn(day, 10))
      }

      let reads = 0
      const getSessions = storage.getSessions.bind(storage)
      storage.getSessions = (...args) => {
        reads++
        return getSessions(...args)
      }
      const calendar = await tracker.getPracticeCalendar()
      storage.getSessions = getSessions

      expect(calendar.size).toBe(3)
      expect(reads).toBe(1)
    })
  })

  describe('practiceStreaks', () => {
    const today = new Date('2026-03-10T21:00:00')

    it('counts the run ending today', () => {
      const days = ['2026-03-08', '2026-03-09', '2026-03-10']
      expect(practiceStreaks(days, today)).toEqual({ current: 3, longest: 3 })
    })

    it("keeps yesterday's run alive while today is still playable", () => {
      const days = ['2026-03-08', '2026-03-09']
      expect(practiceStreaks(days, today).current).toBe(2)
    })

    it('breaks the current run once a whole day has been missed', () => {
      const days = ['2026-03-07', '2026-03-08']
      expect(practiceStreaks(days, today).current).toBe(0)
    })

    it('finds the longest run anywhere in the history', () => {
      const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-02-01', '2026-03-10']
      expect(practiceStreaks(days, today)).toEqual({ current: 1, longest: 4 })
    })

    it('reports nothing on an empty history', () => {
      expect(practiceStreaks([], today)).toEqual({ current: 0, longest: 0 })
    })

    it('runs across month and year boundaries', () => {
      const days = ['2025-12-30', '2025-12-31', '2026-01-01']
      expect(practiceStreaks(days, new Date('2026-01-01T21:00:00'))).toEqual({ current: 3, longest: 3 })
    })
  })

  describe('shiftDayKey', () => {
    it('crosses a month end and a leap day', () => {
      expect(shiftDayKey('2026-01-31', 1)).toBe('2026-02-01')
      expect(shiftDayKey('2024-03-01', -1)).toBe('2024-02-29')
    })
  })

  describe('levelFor', () => {
    it('leaves a day with no practice at level 0', () => {
      expect(levelFor(0)).toBe(0)
      expect(levelFor(undefined)).toBe(0)
    })

    it('deepens with the time played', () => {
      const minutes = (n) => n * 60 * 1000
      expect(levelFor(minutes(5))).toBe(1)
      expect(levelFor(minutes(10))).toBe(2)
      expect(levelFor(minutes(29))).toBe(2)
      expect(levelFor(minutes(30))).toBe(3)
      expect(levelFor(minutes(60))).toBe(4)
      expect(levelFor(minutes(300))).toBe(4)
    })
  })
})
