// The practice journal, as the pages read it back: a line per score played on
// a day (the library's journal, the calendar's day panel), a score's own days
// (its history), and the calendar's squares, with what a year of them adds up
// to and the streaks they make. Pure: sessions in, rows out; the tracker reads
// the sessions and the names of their scores (practiceTracker.js).
import { localDayKey, shiftDayKey, sessionDay } from './days.js'
import { computeSessionDuration, getFullPlaythroughs, getLastMeasureEndTime, playedInFull } from './practiceTime.js'

// One day of the journal, its scores named by `names` (scoreId →
// { title, composer }).
export function buildDailyLog(sessions, names) {
  const scoreMap = new Map()
  for (const session of sessions) {
    if (!scoreMap.has(session.scoreId)) {
      const name = names.get(session.scoreId)
      scoreMap.set(session.scoreId, newEntry({
        scoreId: session.scoreId,
        scoreTitle: name?.title || null,
        composer: name?.composer || null,
      }))
    }
    addSession(scoreMap.get(session.scoreId), session)
  }

  return Array.from(scoreMap.values())
    .map(withPlaythroughs)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
}

// A line of the journal — a score, on a day — or a day of a score's history:
// the sessions grouped under it, and what they add up to (addSession).
function newEntry(fields) {
  return {
    ...fields,
    sessions: [],
    measuresWorked: new Set(),
    measuresReinforced: new Set(),
    totalPracticeTimeMs: 0,
    lastPlayedAt: null,
  }
}

// What a session adds to the entry it is grouped under, the same for both
// groupings.
function addSession(entry, session) {
  entry.sessions.push(session)
  entry.totalPracticeTimeMs += computeSessionDuration(session)
  const lastPlayedAt = getLastMeasureEndTime(session)
  if (!entry.lastPlayedAt || lastPlayedAt > entry.lastPlayedAt) entry.lastPlayedAt = lastPlayedAt
  for (const measure of session.measures) {
    const measureIndex = Number(measure.sourceMeasureIndex)
    entry.measuresWorked.add(measureIndex)
    if (session.mode === 'training') entry.measuresReinforced.add(measureIndex)
  }
}

// The tail both groupings share: the sets they filled become sorted arrays,
// and their sessions become the runs through the whole score they hold.
// `timesPlayedInFull` counts by playedInFull, as the calendar and the statuses
// do — a run from before runs were timed included, which has no place in
// `fullPlaythroughs`.
// The sessions themselves stay behind: nothing on screen reads them, and the
// entries are held in the pages' reactive state.
function withPlaythroughs({ sessions, ...entry }) {
  const fullPlaythroughs = getFullPlaythroughs(sessions)
  return {
    ...entry,
    measuresWorked: Array.from(entry.measuresWorked).sort((a, b) => a - b),
    measuresReinforced: Array.from(entry.measuresReinforced).sort((a, b) => a - b),
    fullPlaythroughs,
    timesPlayedInFull: sessions.filter(playedInFull).length,
  }
}

// A score's days, newest first, keyed like the journal's.
export function buildScoreHistory(sessions) {
  const byDay = new Map()
  for (const session of sessions) {
    const date = sessionDay(session)
    if (!byDay.has(date)) byDay.set(date, newEntry({ date }))
    addSession(byDay.get(date), session)
  }
  return Array.from(byDay.values())
    .map(withPlaythroughs)
    .sort((a, b) => b.date.localeCompare(a.date))
}

// One row per practised day, keyed by local day ('YYYY-MM-DD'), for the
// year-at-a-glance calendar. Days with no practice are simply absent.
export function buildPracticeCalendar(sessions) {
  const byDay = new Map()
  for (const session of sessions) {
    const key = sessionDay(session)
    if (!byDay.has(key)) byDay.set(key, { practiceTimeMs: 0, timesPlayedInFull: 0 })
    const day = byDay.get(key)
    day.practiceTimeMs += computeSessionDuration(session)
    if (playedInFull(session)) day.timesPlayedInFull += 1
  }
  return byDay
}

// What a year of the calendar adds up to. The streaks are deliberately not in
// here: a run that started in December is one run, and cutting it at 1 January
// would be an artefact of the view — practiceStreaks() reads the whole history.
export function practiceYearStats(calendar, year) {
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
  return { days, practiceTimeMs, playthroughs }
}

// Runs of consecutive practised days, from a collection of day keys: the one
// ending now, and the longest anywhere in the history.
//
// The current run tolerates a silent today. Until midnight the day is still
// playable, so a streak that stands at yesterday is alive, not broken — the
// opposite reading would show "0" every morning to someone who practises
// every evening.
export function practiceStreaks(dayKeys, today = new Date()) {
  const days = new Set(dayKeys)

  let longest = 0
  let run = 0
  let previous = null
  for (const key of [...days].sort()) {
    run = previous && shiftDayKey(previous, 1) === key ? run + 1 : 1
    previous = key
    if (run > longest) longest = run
  }

  const todayKey = localDayKey(today)
  let cursor = days.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1)
  let current = 0
  while (days.has(cursor)) {
    current += 1
    cursor = shiftDayKey(cursor, -1)
  }

  return { current, longest }
}
