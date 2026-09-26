// Practice calendar: a year of days as coloured squares, GitHub-contributions
// style, so a glance answers "have I kept at it?" rather than "what did I play
// last Tuesday?" — the question the library's journal already answers.
//
// The whole history is read once (one pass over the sessions store) and sliced
// per year in memory: the year arrows then redraw without touching IndexedDB,
// and the streaks stay honest across a year boundary, which a per-year read
// could not do.
import { initStorage } from './storage.js'
import { initPracticeTracker, localDayKey, practiceStreaks, practiceYearStats } from './practiceTracker.js'
import { initAutoSync } from './autoSync.js'
import { onDayChange } from './dayRollover.js'
import { formatDuration, formatVerboseDate, scorePageUrl } from './utils.js'
import { journalEntryHelpers } from './journalEntries.js'
import { t, locale } from './i18n.js'

// Colour bands for a day's square, in minutes of practice. Fixed rather than
// relative to the year's own maximum: the grid is there to say whether a day
// was a real practice day, and a scale stretched to fit one marathon Sunday
// would repaint every ordinary half-hour as pale.
const LEVEL_THRESHOLDS_MS = [10, 30, 60].map((minutes) => minutes * 60 * 1000)

// Every band, "nothing" included — what the legend draws, and the one place
// that says how many there are. styles.css supplies a colour per level.
export const LEVELS = LEVEL_THRESHOLDS_MS.map((_, index) => index + 1)
LEVELS.unshift(0)

const MONTH_FORMATTER = new Intl.DateTimeFormat(locale(), { month: 'short' })

// Rows 0..6 are Monday..Sunday — the columns run Monday-first, as every
// European calendar prints them. Only every other row is labelled: seven
// labels on a 12px rhythm would collide.
const WEEKDAY_LABEL_ROWS = [0, 2, 4]

export function levelFor(practiceTimeMs) {
  if (!practiceTimeMs) return 0
  let level = 1
  for (const limit of LEVEL_THRESHOLDS_MS) {
    if (practiceTimeMs >= limit) level += 1
  }
  return level
}

// The Monday on or before `date`.
function mondayOnOrBefore(date) {
  const monday = new Date(date)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

export function practiceApp() {
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)

  // Map<'YYYY-MM-DD', { practiceTimeMs, timesPlayedInFull }>, the whole history.
  let calendar = new Map()
  // All-time and therefore independent of the displayed year: computed once
  // per read rather than on every year switch.
  let streaks = { current: 0, longest: 0 }
  // Day panels already opened, by day key. Each miss costs a full pass over the
  // sessions store (getDailyLog has no index on startedAt to lean on), and
  // clicking around the grid is the whole point of the panel. Dropped whenever
  // the underlying data is re-read.
  let dayEntries = new Map()

  return {
    ready: false,
    year: new Date().getFullYear(),
    // The bounds of the year arrows: this year, back to the first with data.
    // The upper bound is derived, not stored: a page left open across New
    // Year's Eve would otherwise cap the arrows at the year that just ended.
    firstYear: new Date().getFullYear(),
    get latestYear() {
      return new Date().getFullYear()
    },
    levels: LEVELS,
    weeks: [],
    monthLabels: [],
    weekdayLabels: [],
    stats: { days: 0, practiceTimeMs: 0, playthroughs: 0, current: 0, longest: 0 },
    // The day whose detail panel is open, and the scores it holds.
    selected: null,
    selectedEntries: [],

    async init() {
      this.weekdayLabels = buildWeekdayLabels()
      await practiceTracker.init()
      await this.reload()
      this.ready = true

      // Same reasoning as the library: this page only ever shows synced data,
      // so it syncs on open and redraws whatever came down.
      initAutoSync({ storage, practiceTracker }, {
        syncOnOpen: true,
        onSynced: (summary) => {
          if (summary.pulled) this.reload()
        },
      })

      // One square is marked today and the streaks end there. Nothing was
      // stored in the meantime — practice happens on the score page, and what
      // syncs down arrives on the branch above — so the grid is redrawn from
      // the history already in memory rather than read again.
      onDayChange(() => this.redraw())
    },

    async reload() {
      calendar = await practiceTracker.getPracticeCalendar()
      dayEntries = new Map()
      this.redraw()
      // The panel's day is unchanged, but a sync may have added practice to it.
      if (this.selected) await this.openDay(this.selected)
    },

    // Everything derived from `calendar` and from today, with no read behind
    // it: what a day rollover needs, and the tail of every reload().
    redraw() {
      streaks = practiceStreaks(calendar.keys())
      this.firstYear = Math.min(this.latestYear, ...[...calendar.keys()].map((key) => Number(key.slice(0, 4))))
      if (this.year < this.firstYear) this.year = this.latestYear
      this.buildGrid()
    },

    // Rebuilds the grid, its month labels and the year's stats. Everything the
    // template reads is written here, so switching year is one call and the
    // template never recomputes a 371-cell array per binding.
    buildGrid() {
      const todayKey = localDayKey(new Date())
      const lastDay = new Date(this.year, 11, 31)
      const cursor = mondayOnOrBefore(new Date(this.year, 0, 1))

      const weeks = []
      while (cursor <= lastDay) {
        const week = []
        for (let row = 0; row < 7; row += 1) {
          const date = new Date(cursor)
          const key = localDayKey(date)
          const practiceTimeMs = calendar.get(key)?.practiceTimeMs ?? 0
          // A day is playable when it is one of this year's and has happened:
          // the neighbouring years' days keep the columns aligned, and so do
          // the rest of the current one, but neither is a day you could have
          // practised.
          const playable = date.getFullYear() === this.year && key <= todayKey
          week.push({
            key,
            date,
            playable,
            isToday: key === todayKey,
            level: levelFor(practiceTimeMs),
            // Precomputed rather than bound as a call: the template reads it
            // twice (title + aria-label), on every cell.
            label: playable ? dayLabel(date, practiceTimeMs) : null,
          })
          cursor.setDate(cursor.getDate() + 1)
        }
        weeks.push(week)
      }

      // Assigned whole, so Alpine proxies the grid and notifies its x-for once
      // rather than 53 times.
      this.weeks = weeks
      this.monthLabels = buildMonthLabels(weeks, this.year)
      this.stats = { ...practiceYearStats(calendar, this.year), ...streaks }
      this.scrollToToday()
    },

    // On a screen too narrow for 53 columns, the interesting end of the
    // current year is today's, not January's. Past years open where they
    // start, since none of their columns is more current than another.
    scrollToToday() {
      this.$nextTick(() => {
        const box = this.$refs.calendar
        if (!box) return
        const marker = box.querySelector('.pt-calendar__day[data-today="true"]')
        if (!marker) {
          box.scrollLeft = 0
          return
        }
        const overshoot = marker.getBoundingClientRect().right - box.getBoundingClientRect().right
        if (overshoot > 0) box.scrollLeft += overshoot + 8
      })
    },

    setYear(year) {
      if (year < this.firstYear || year > this.latestYear || year === this.year) return
      this.year = year
      this.closeDay()
      this.buildGrid()
    },

    // Clicking the open day closes it, the way the library's filter pills
    // toggle off on a second click.
    async toggleDay(day) {
      if (!day.playable) return
      if (this.selected?.key === day.key) return this.closeDay()
      await this.openDay(day)
    },

    // The detail panel: which scores that day, and for how long. Read on
    // demand — a year of these up front would be a year of aggregate lookups
    // for the one day anybody clicks.
    async openDay(day) {
      this.selected = day
      if (!dayEntries.has(day.key)) dayEntries.set(day.key, await practiceTracker.getDailyLog(day.date))
      this.selectedEntries = dayEntries.get(day.key)
    },

    closeDay() {
      this.selected = null
      this.selectedEntries = []
    },

    selectedLabel() {
      return this.selected ? formatVerboseDate(this.selected.date) : ''
    },

    formatDuration,
    scorePageUrl,
    ...journalEntryHelpers,
  }
}

// The square's tooltip: the day, and what was played on it.
function dayLabel(date, practiceTimeMs) {
  const day = formatVerboseDate(date)
  if (!practiceTimeMs) return t('practice.dayEmpty', { date: day })
  return t('practice.dayTooltip', { date: day, duration: formatDuration(practiceTimeMs) })
}

// Row labels, taken from a real week so they follow the active locale.
function buildWeekdayLabels() {
  const formatter = new Intl.DateTimeFormat(locale(), { weekday: 'short' })
  const monday = mondayOnOrBefore(new Date())
  return Array.from({ length: 7 }, (_, row) => {
    if (!WEEKDAY_LABEL_ROWS.includes(row)) return ''
    const date = new Date(monday)
    date.setDate(date.getDate() + row)
    return formatter.format(date)
  })
}

// A month gets its name above the first column that actually starts in it, so
// the label sits over the bulk of its own squares rather than over the tail of
// the previous month. Columns with no label render an empty slot, which is what
// keeps the row aligned with the grid.
function buildMonthLabels(weeks, year) {
  const labels = weeks.map(() => '')
  let previous = null
  weeks.forEach((week, index) => {
    const monday = week[0].date
    if (monday.getFullYear() !== year) return
    if (monday.getMonth() === previous) return
    previous = monday.getMonth()
    labels[index] = MONTH_FORMATTER.format(monday)
  })
  return labels
}
