// Practice calendar: a year of days as coloured squares, GitHub-contributions
// style, so a glance answers "have I kept at it?" rather than "what did I play
// last Tuesday?" — the question the library's journal already answers.
//
// The whole history is read once (one pass over the sessions store) and sliced
// per year in memory: the year arrows then redraw without touching IndexedDB,
// and the streaks stay honest across a year boundary, which a per-year read
// could not do.
import { initStorage } from './storage.js'
import { initPracticeTracker, localDayKey, practiceStreaks } from './practiceTracker.js'
import { initAutoSync } from './autoSync.js'
import { formatDuration, scorePageUrl } from './utils.js'
import { t, locale } from './i18n.js'

// Colour bands for a day's square, in minutes of practice. Fixed rather than
// relative to the year's own maximum: the grid is there to say whether a day
// was a real practice day, and a scale stretched to fit one marathon Sunday
// would repaint every ordinary half-hour as pale.
const LEVEL_THRESHOLDS_MS = [10, 30, 60].map((minutes) => minutes * 60 * 1000)

const MONTH_FORMATTER = new Intl.DateTimeFormat(locale(), { month: 'short' })
const DAY_FORMATTER = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

// Rows 0..6 are Monday..Sunday — the columns run Monday-first, as every
// European calendar prints them. Only every other row is labelled: seven
// labels on a 12px rhythm would collide.
const WEEKDAY_LABEL_ROWS = [0, 2, 4]

export function levelFor(practiceTimeMs) {
  if (!practiceTimeMs) return 0
  return 1 + LEVEL_THRESHOLDS_MS.filter((limit) => practiceTimeMs >= limit).length
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

  // Map<'YYYY-MM-DD', { practiceTimeMs, sessions, scores, timesPlayedInFull }>
  let calendar = new Map()

  return {
    ready: false,
    year: new Date().getFullYear(),
    years: [new Date().getFullYear()],
    weeks: [],
    monthLabels: [],
    weekdayLabels: [],
    stats: { days: 0, practiceTimeMs: 0, current: 0, longest: 0, playthroughs: 0 },
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
    },

    async reload() {
      calendar = await practiceTracker.getPracticeCalendar()
      const currentYear = new Date().getFullYear()
      const firstYear = Math.min(currentYear, ...[...calendar.keys()].map((key) => Number(key.slice(0, 4))))
      this.years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i)
      if (!this.years.includes(this.year)) this.year = currentYear
      this.buildGrid()
      // buildGrid() rebuilt every day object; re-point the open panel at the
      // fresh one and re-read it, rather than leaving it stale (a sync that
      // pulled today's practice must show up in the panel too).
      if (!this.selected) return
      const reopened = this.weeks.flat().find((day) => day.key === this.selected.key)
      if (reopened) await this.openDay(reopened)
      else this.closeDay()
    },

    // Rebuilds the grid, its month labels and the year's stats. Everything the
    // template reads is written here, so switching year is one call and the
    // template never recomputes a 371-cell array per binding.
    buildGrid() {
      const todayKey = localDayKey(new Date())
      const lastDay = new Date(this.year, 11, 31)
      const cursor = mondayOnOrBefore(new Date(this.year, 0, 1))

      this.weeks = []
      while (cursor <= lastDay) {
        const week = []
        for (let i = 0; i < 7; i += 1) {
          const date = new Date(cursor)
          const key = localDayKey(date)
          const day = calendar.get(key)
          week.push({
            key,
            date,
            // Days of the neighbouring years keep the columns aligned but stay
            // blank: this grid is one year, not a rolling window.
            inYear: date.getFullYear() === this.year,
            future: key > todayKey,
            isToday: key === todayKey,
            practiceTimeMs: day?.practiceTimeMs ?? 0,
            scores: day?.scores ?? 0,
            timesPlayedInFull: day?.timesPlayedInFull ?? 0,
            level: levelFor(day?.practiceTimeMs),
          })
          cursor.setDate(cursor.getDate() + 1)
        }
        this.weeks.push(week)
      }

      this.monthLabels = buildMonthLabels(this.weeks, this.year)
      this.stats = buildStats(calendar, this.year)
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
      if (!this.years.includes(year) || year === this.year) return
      this.year = year
      this.closeDay()
      this.buildGrid()
    },

    // Clicking the open day closes it, the way the library's filter pills
    // toggle off on a second click.
    async toggleDay(day) {
      if (!day.inYear || day.future) return
      if (this.selected?.key === day.key) return this.closeDay()
      await this.openDay(day)
    },

    // The detail panel: which scores that day, and for how long. Read on
    // demand — a year of these up front would be a year of aggregate lookups
    // for the one day anybody clicks.
    async openDay(day) {
      this.selected = day
      this.selectedEntries = await practiceTracker.getDailyLog(day.date)
    },

    closeDay() {
      this.selected = null
      this.selectedEntries = []
    },

    dayLabel(day) {
      const date = DAY_FORMATTER.format(day.date)
      if (!day.practiceTimeMs) return t('practice.dayEmpty', { date })
      return t('practice.dayTooltip', { date, duration: formatDuration(day.practiceTimeMs) })
    },

    selectedLabel() {
      return this.selected ? DAY_FORMATTER.format(this.selected.date) : ''
    },

    formatDuration,
    scorePageUrl,
  }
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

// Year totals, plus the streaks — which are read over the whole history, not
// over the displayed year: a run that started in December is one run, and
// cutting it at 1 January would be an artefact of the view.
function buildStats(calendar, year) {
  const prefix = `${year}-`
  let days = 0
  let practiceTimeMs = 0
  let playthroughs = 0
  for (const [key, day] of calendar) {
    if (!key.startsWith(prefix)) continue
    days += 1
    practiceTimeMs += day.practiceTimeMs
    playthroughs += day.timesPlayedInFull
  }
  return { days, practiceTimeMs, playthroughs, ...practiceStreaks(calendar.keys()) }
}
