import { describe, it, expect, afterEach, vi } from 'vitest'
import { localDayKey } from '../../public/js/days.js'
import { formatDate, formatRelativeDate } from '../../public/js/utils.js'

// Node reads TZ afresh whenever it changes, so each test stands in the
// timezone its case needs.
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('days', () => {
  it('files a moment under the day it is where the player is', () => {
    vi.stubEnv('TZ', 'Europe/Paris')
    expect(localDayKey('2026-06-09T22:30:00.000Z')).toBe('2026-06-10')
  })

  // new Date('2026-06-10') is UTC midnight: the 9th, in the evening, in New York.
  it('keeps a day key for the day it names, west of Greenwich too', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(localDayKey('2026-06-10')).toBe('2026-06-10')
    vi.setSystemTime(new Date(2026, 5, 10, 12))
    expect(formatDate('2026-06-10')).toBe('today')
  })

  // Clocks went forward on 28 March 2027: that day lasted 23 hours.
  it('calls the day before a clock change yesterday', () => {
    vi.stubEnv('TZ', 'Europe/Paris')
    vi.setSystemTime(new Date(2027, 2, 29, 10))
    expect(formatRelativeDate(new Date(2027, 2, 28, 20))).toBe('yesterday')
  })
})
