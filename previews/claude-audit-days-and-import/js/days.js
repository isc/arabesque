// Days as the player lives them: in the device's own timezone, midnight to
// midnight. The journal, the calendar, a score's history, the practice days
// the statuses count and every "yesterday" on screen group by these — and
// each used to work the day out its own way: one took the UTC date, which
// files a session played at 00:30 in Paris under the day before, and one
// divided milliseconds, which a clock change makes 23 or 25 hours long.

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

// The day a moment falls on, as 'YYYY-MM-DD'.
export function localDayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The day `delta` days away from `key`. Built at midday so a DST transition —
// which in a few timezones happens at midnight — can't land the result on the
// neighbouring day.
export function shiftDayKey(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  return localDayKey(new Date(year, month - 1, day + delta, 12))
}

// Local midnight of the day `date` falls on: a Date, a timestamp, an ISO
// string or a day key. A key is read as the local day it names — `new
// Date('YYYY-MM-DD')` would read it as UTC midnight, which west of Greenwich
// is the evening before.
export function startOfLocalDay(date) {
  if (typeof date === 'string' && DAY_KEY.test(date)) {
    const [year, month, day] = date.split('-').map(Number)
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
