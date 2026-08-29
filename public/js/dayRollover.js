// "Today" is not a constant, and the pages that print it are built once.
//
// The library's journal lays out its rows from `new Date()` when it loads, and
// the calendar marks one square as today. On an iPad neither page is ever
// reloaded — the app is suspended and woken for weeks — so the morning after a
// session, "aujourd'hui" still held the evening before's work.
//
// Two things turn the day over: coming back to the app after it was away
// across midnight, and the clock moving past midnight — or jumping, when a
// device lands and picks up another timezone — with the page still open.
//
// The foreground event is what should carry the first case, and in the wrapper
// it doesn't: a library page woken with the app still read "aujourd'hui" over
// the evening before, seconds after the app came back, and only a navigation
// put it right. Whatever WKWebView does with visibility across a suspension,
// the poll is the trigger to count on — so its period is not an idle cost to
// keep low, it is how long a stale journal stays on screen, and a second is the
// budget. The check compares one day key to another and the handler behind it
// runs on the one tick a day where the answer changes; a timer armed for
// midnight would spare even that, and would sleep through both the suspension
// and the jump.
//
// The foreground event stays all the same, and not for the second it saves: a
// hidden tab has its timers throttled to about one a minute, so a tab switched
// back to is the case the poll alone would answer slowest.
import { localDayKey } from './practiceTracker.js'
import { onForeground } from './utils.js'

const POLL_MS = 1000

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
