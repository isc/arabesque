// "Today" is not a constant, and the pages that print it are built once.
//
// The library's journal lays out its rows from `new Date()` when it loads, and
// the calendar marks one square as today. On an iPad neither page is ever
// reloaded — the app is suspended and woken for weeks — so the morning after a
// session, "aujourd'hui" still held the evening before's work.
//
// onDayChange() fires when the local day key changes, on two triggers: the page
// coming back to the foreground, and a one-minute poll.
//
// The foreground trigger is the one that answers the iPad, and for a while it
// answered nothing at all: inside the wrapper no foreground event reached the
// page, and the journal stayed a day behind until the poll caught it a minute
// later — long enough to be read wrong. onForeground() now hears the wrapper
// itself (see utils.js), which is where that belonged.
//
// The poll stays for the page nobody leaves: open across midnight with the app
// in front, no foreground event to wait for. It also catches a clock that
// jumps — a device landing in another timezone moves the wall clock with no
// elapsed time to wait for — which a timer armed for midnight would sleep
// through. One day-key comparison a minute costs nothing next to the handler it
// guards.
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
