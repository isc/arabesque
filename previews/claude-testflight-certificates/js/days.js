// Days as the player lives them: in the device's own timezone, midnight to
// midnight. The journal, the calendar, a score's history, the practice days
// the statuses count and every "yesterday" on screen group by these — and
// each used to work the day out its own way: one took the UTC date, which
// files a session played at 00:30 in Paris under the day before, and one
// divided milliseconds, which a clock change makes 23 or 25 hours long.

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const isDayKey = (date) => typeof date === 'string' && DAY_KEY.test(date)
const dayKeyParts = (key) => key.split('-').map(Number)

// The day a moment falls on, as 'YYYY-MM-DD' — or the day a key already names.
export function localDayKey(date) {
  if (isDayKey(date)) return date
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The day `delta` days away from `key`. Built at midday so a DST transition —
// which in a few timezones happens at midnight — can't land the result on the
// neighbouring day.
export function shiftDayKey(key, delta) {
  const [year, month, day] = dayKeyParts(key)
  return localDayKey(new Date(year, month - 1, day + delta, 12))
}

// Local midnight of the day `date` falls on: a Date, a timestamp, an ISO
// string or a day key. A key is read as the local day it names — `new
// Date('YYYY-MM-DD')` would read it as UTC midnight, which west of Greenwich
// is the evening before.
export function startOfLocalDay(date) {
  if (isDayKey(date)) {
    const [year, month, day] = dayKeyParts(date)
    return new Date(year, month - 1, day)
  }
  const d = new Date(date)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Calendar days from `from`'s day to `to`'s. Rounded: a day with a clock
// change in it lasts 23 or 25 hours, and is still one day.
export function daysBetween(from, to) {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / 86_400_000)
}

// Oldest first, for anything with a `startedAt` — a session, a run. It is
// always an ISO string in UTC, so it sorts as text: a comparator building two
// Dates per comparison was most of the cost of a call that runs at every
// measure boundary.
export const byStartedAt = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0)

// The day a session counts for: the one it started on, where the player is.
export const sessionDay = (session) => localDayKey(session.startedAt)
