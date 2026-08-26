// "Today" is not a constant, and the pages that print it are built once.
//
// The library's journal lays out its rows from `new Date()` when it loads, and
// the calendar marks one square as today. On an iPad neither page is ever
// reloaded — the app is suspended and woken for weeks — so the morning after a
// session, "aujourd'hui" still held the evening before's work.
//
// Two things turn the day over: coming back to the app after it was away
// across midnight, and the clock moving past midnight — or jumping, when a
// device lands and picks up another timezone — with the page still open. Hence
// a foreground trigger and a poll. The poll compares one day key a minute, next
// to handlers that walk IndexedDB; a single timer armed for midnight would save
// nothing measurable and would sleep through a clock jump.
import { localDayKey } from './practiceTracker.js'
import { onForeground } from './utils.js'

const POLL_MS = 60000

export function onDayChange(handler) {
  let day = localDayKey(new Date())

  const check = () => {
    const today = localDayKey(new Date())
    if (today === day) return
    day = today
    handler()
  }

  onForeground(check)
  setInterval(check, POLL_MS)
}
