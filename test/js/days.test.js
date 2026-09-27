import { describe, it, expect, afterEach, vi } from 'vitest'
import { localDayKey, startOfLocalDay, daysBetween } from '../../public/js/days.js'
import { formatDate, formatRelativeDate } from '../../public/js/utils.js'

// Node reads TZ afresh whenever it is set, so each test stands in the
// timezone its case needs.
const TZ = process.env.TZ
function inTimezone(zone) {
  process.env.TZ = zone
}

afterEach(() => {
  if (TZ === undefined) delete process.env.TZ
  else process.env.TZ = TZ
  vi.useRealTimers()
})

describe('days', () => {
  it('files a moment under the day it is where the player is', () => {
    inTimezone('Europe/Paris')
    expect(localDayKey('2026-06-09T22:30:00.000Z')).toBe('2026-06-10')
  })

  // new Date('2026-06-10') is UTC midnight: the 9th, in the evening, in New York.
  it('reads a day key as the day it names, west of Greenwich too', () => {
    inTimezone('America/New_York')
    expect(localDayKey(startOfLocalDay('2026-06-10'))).toBe('2026-06-10')
  })

  // Clocks went forward on 28 March 2027 and back on 31 October: 23 hours,
  // then 25.
  it('counts a day with a clock change in it as one', () => {
    inTimezone('Europe/Paris')
    expect(daysBetween(new Date(2027, 2, 28, 9), new Date(2027, 2, 29, 9))).toBe(1)
    expect(daysBetween(new Date(2027, 9, 31, 9), new Date(2027, 10, 1, 9))).toBe(1)
  })
})

describe('dates on screen', () => {
  function today(date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(date)
  }

  it('calls the day before a clock change yesterday', () => {
    inTimezone('Europe/Paris')
    today(new Date(2027, 2, 29, 10))
    expect(formatRelativeDate(new Date(2027, 2, 28, 20))).toBe('yesterday')
  })

  it('calls today’s key today, whatever the timezone', () => {
    inTimezone('America/New_York')
    today(new Date(2026, 5, 10, 12))
    expect(formatDate('2026-06-10')).toBe('today')
  })
})
