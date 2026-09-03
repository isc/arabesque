import { initStorage } from './storage.js'
import { TWO_HANDS, handsKey, playthroughHands } from './hands.js'

// Where a session interrupted by a page teardown waits to be closed properly
// (see stashPendingSession).
const PENDING_SESSION_KEY = 'arabesque:pending-session'

// Marks the one-off repair of sessions stranded before those snapshots existed
// (see closeStrandedSessions).
const STRANDED_REPAIR_KEY = 'arabesque:stranded-sessions-closed'

// How quiet a session must be before the repair treats it as abandoned rather
// than in progress somewhere else. Well beyond any gap between two measures,
// and the sessions this exists for are months old.
const STRANDED_MIN_AGE_MS = 60 * 60 * 1000

// Default knobs for interruption removal. A segment is "aberrant" (an
// interruption) when it exceeds max(floor, factor × median) of its own kind.
// Measures (~7s) and gaps (~0.7s) live on different scales, so each has its own
// threshold. Calibrated on real exported data: the gap floor sits at the clear
// knee of the gap distribution (~8s); the measure factor barely matters because
// real mid-measure interruptions are 15–30× the median, far above any
// reasonable threshold.
//
// These values are baked into stored aggregates: totalPracticeTimeMs is
// accumulated with them at session end, while the journal and the per-score
// history re-derive with them on every read. Retuning them desyncs the two
// until rebuildAggregates() replays the sessions.
const INTERRUPTION_NORMALIZATION = {
  measureFloorMs: 15000,
  measureFactor: 4,
  gapFloorMs: 8000,
  gapFactor: 4,
}

// Reinforcement suggestions look at this many of a score's most recent
// sessions. What was fumbled months ago says nothing about what needs work
// today, and the window bounds a computation that runs at every measure.
const REINFORCEMENT_WINDOW_SESSIONS = 10

// Consecutive clean passes that retire a measure from the suggestions — the
// bar reinforcement mode itself sets to declare a measure done.
const REINFORCEMENT_CLEAN_STREAK = 3

// Sessions a measure must span before its error rate can be called stagnant.
const STAGNATION_MIN_SESSIONS = 3

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// Measure attempts overlapping [start, end], in chronological order, flattened
// to what their readers need: when it started, how long it took, which hands
// played it. Bounds are inclusive — a measure played faster than the clock
// ticks would otherwise fall out of the very run it belongs to, and an attempt
// touching a bound with no overlap adds nothing to the time either way.
// Defaults to every attempt in the session.
function sessionAttempts(session, start = -Infinity, end = Infinity) {
  const attempts = []
  for (const measure of session.measures || []) {
    for (const attempt of measure.attempts || []) {
      if (!attempt.startedAt) continue
      const s = new Date(attempt.startedAt).getTime()
      const durationMs = attempt.durationMs || 0
      if (s + durationMs >= start && s <= end) {
        attempts.push({ start: s, durationMs, hands: attempt.hands })
      }
    }
  }
  return attempts.sort((a, b) => a.start - b.start)
}

// When the last of these attempts finished.
function lastAttemptEnd(intervals) {
  return intervals.reduce((last, i) => Math.max(last, i.start + i.durationMs), 0)
}

// Time actually spent playing across [start, end], with interruptions (phone
// calls, breaks, a score left open on the desk) removed. A pause inflates either
// a single measure's duration (interrupted mid-measure) or an inter-measure gap
// (interrupted between measures). We detect aberrant segments — those far above
// the window's own norm — and replace each with a typical value of its own kind:
//   - aberrant measure → longest normal measure (the notes were still played)
//   - aberrant gap      → median normal gap (a transition, not playing)
function normalizedPlayingTime(intervals, start, end) {
  const { measureFloorMs, measureFactor, gapFloorMs, gapFactor } = INTERRUPTION_NORMALIZATION

  // Inter-measure gaps (including the trailing gap up to the end of the window).
  const gaps = []
  let cursor = start
  for (const { start: s, durationMs } of intervals) {
    gaps.push(s - cursor)
    cursor = Math.max(cursor, s + durationMs)
  }
  gaps.push(end - cursor)
  const positiveGaps = gaps.filter((g) => g > 0)

  // Per-kind aberration thresholds, calibrated on this window's own data.
  const measureDurations = intervals.map((i) => i.durationMs)
  const measureThreshold = Math.max(measureFloorMs, measureFactor * median(measureDurations))
  const gapThreshold = Math.max(gapFloorMs, gapFactor * median(positiveGaps))

  // Replacement values: the "norm" of each kind.
  const normalMeasures = measureDurations.filter((d) => d <= measureThreshold)
  const measureCap = normalMeasures.length ? Math.max(...normalMeasures) : measureThreshold
  const gapReplacement = median(positiveGaps.filter((g) => g <= gapThreshold))

  // Re-tile [start, end]: clamp aberrant segments, keep the rest as-is.
  const clampGap = (gap) => (gap > gapThreshold ? gapReplacement : gap)
  let total = 0
  cursor = start
  for (const { start: s, durationMs } of intervals) {
    const gap = s - cursor
    if (gap > 0) total += clampGap(gap)
    total += durationMs > measureThreshold ? measureCap : durationMs
    cursor = Math.max(cursor, s + durationMs)
  }
  const trailingGap = end - cursor
  if (trailingGap > 0) total += clampGap(trailingGap)

  return Math.round(total)
}

// When the run a completed session holds started and finished. A session
// carries at most one: the score page ends it and opens the next one as soon
// as the piece is finished.
function playthroughWindow(session) {
  return {
    start: new Date(session.playthroughStartedAt).getTime(),
    end: new Date(session.completedAt).getTime(),
  }
}

// A completed playthrough, timed from when the player started it to when they
// finished. Falls back to raw wall-clock when per-measure timing is unavailable.
export function computePlaythroughDuration(session) {
  const { start, end } = playthroughWindow(session)
  return playthroughDuration(sessionAttempts(session, start, end), start, end)
}

function playthroughDuration(attempts, start, end) {
  if (attempts.length === 0) return end - start
  return normalizedPlayingTime(attempts, start, end)
}

// The hands the run held by a completed session was played with.
function completedSessionHands(session) {
  if (!session.playthroughStartedAt) return TWO_HANDS
  const { start, end } = playthroughWindow(session)
  return playthroughHands(sessionAttempts(session, start, end))
}

// The rule the whole app counts by: the piece played in full is a run that
// went from end to end with both hands on the whole way.
export function playedInFull(session) {
  return Boolean(session.completedAt) && completedSessionHands(session) === TWO_HANDS
}

// Practice time credited to a session: first measure attempt to last, minus
// interruptions. It has to go through the same normalization as a playthrough —
// on a raw span, a score left open on the desk counts in full, and a single
// 79-minute attempt on one measure once turned ten minutes of practice into
// 1h33 in the journal.
export function computeSessionDuration(session) {
  const attempts = sessionAttempts(session)
  if (attempts.length === 0) return 0
  return normalizedPlayingTime(attempts, attempts[0].start, lastAttemptEnd(attempts))
}

// Day the session belongs to in the viewer's timezone — the journal and the
// calendar are calendars, so a session played at 00:30 belongs to that morning,
// not to the previous UTC day.
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

export function initPracticeTracker(storageInstance = null) {
  const storage = storageInstance || initStorage()

  let currentSession = null
  let currentMeasureAttempt = null
  // Store metadata separately from session (not persisted in session object)
  let currentScoreTitle = null
  let currentComposer = null
  // Set once ensureAggregateTitle() has written title/composer for the
  // current session, so later measures skip the IndexedDB round-trip.
  let aggregateTitleEnsured = false
  // Sessions read for the reinforcement suggestions, kept between measures
  // (see recentSessions).
  let reinforcementSessions = { scoreId: null, sessions: [] }

  return {
    init: async () => {
      await storage.init()
      await flushPendingSession()
      await closeStrandedSessions()
    },
    stashPendingSession,
    clearPendingSession,
    startSession,
    toggleMode,
    startMeasureAttempt,
    recordWrongNote,
    endMeasureAttempt,
    recordMeasureAttempt,
    markScoreCompleted,
    restartPlaythrough,
    endSession,
    getScoreStats,
    getMeasuresToReinforce,
    rankMeasuresToReinforce,
    getDailyLog,
    getDailyLogs,
    getPracticeCalendar,
    getScoreHistory,
    getAllPlaythroughs,
    getAllScores,
    computeScoreStatus,
    rebuildAggregates,
    getCurrentSession: () => currentSession,
  }

  // A session is only closed — endedAt stamped, practice time credited — by
  // endSession(), which writes to IndexedDB and is therefore async. When the
  // page is being torn down (navigating to another score, back to the library,
  // closing the tab), those writes can be abandoned before they commit: the row
  // saved incrementally by endMeasureAttempt() stays with endedAt: null, its
  // time is credited to no aggregate, and cloud sync will never push it because
  // runSync only takes ended sessions. That is how 15 of my first 500 sessions
  // ended up stranded, all of them interrupted mid-piece.
  //
  // localStorage is synchronous, so a snapshot taken on the way out always
  // survives. The next page load reverses it into IndexedDB.
  function stashPendingSession() {
    if (!currentSession || currentSession.measures.length === 0) return
    try {
      localStorage.setItem(
        PENDING_SESSION_KEY,
        JSON.stringify({
          session: { ...currentSession, endedAt: new Date().toISOString() },
          scoreTitle: currentScoreTitle,
          composer: currentComposer,
        })
      )
    } catch {
      // Quota exceeded or no localStorage: nothing better available.
    }
  }

  // With an id, drops the snapshot only if it is that session's — a snapshot
  // belongs to the session that left it behind, and the next session to end
  // must not throw it away before the next page load can replay it.
  function clearPendingSession(sessionId = null) {
    try {
      if (sessionId) {
        const raw = localStorage.getItem(PENDING_SESSION_KEY)
        if (raw && JSON.parse(raw)?.session?.id !== sessionId) return
      }
      localStorage.removeItem(PENDING_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }

  // Closes the session left behind by a page that went away mid-practice.
  // Skips one whose row is already closed: endSession() can have committed and
  // then died before clearing the stash, and crediting it twice would inflate
  // the practice time on every reload.
  async function flushPendingSession() {
    let pending
    try {
      const raw = localStorage.getItem(PENDING_SESSION_KEY)
      if (!raw) return
      pending = JSON.parse(raw)
    } catch {
      clearPendingSession()
      return
    }

    const { session, scoreTitle, composer } = pending ?? {}
    if (session?.id && session.measures?.length) {
      const stored = await storage.getSession(session.id)
      if (!stored?.endedAt) {
        await storage.saveSession(session)
        await updateAggregates(session, { title: scoreTitle, composer })
      }
    }
    clearPendingSession()
  }

  // One-off repair for the sessions stranded before pagehide snapshots existed:
  // played, saved measure by measure, then abandoned by a page teardown that
  // outran endSession(). They sit in the store with endedAt: null, which leaves
  // their practice time credited nowhere and makes them invisible to cloud sync.
  //
  // Crediting them now cannot double-count: endSession() saves the session
  // *before* it calls updateAggregates(), so a row still missing endedAt proves
  // the aggregate step never ran for it.
  //
  // They are closed at the end of their last measure attempt — the moment the
  // player actually stopped, which is what endSession() would have recorded
  // anyway (getLastMeasureEndTime drives lastPlayedAt).
  //
  // Correctness comes from the endedAt filter, which empties after one run; the
  // marker only spares every later page load a full scan of the sessions store.
  async function closeStrandedSessions() {
    try {
      if (localStorage.getItem(STRANDED_REPAIR_KEY)) return
    } catch {
      return // no localStorage: skip rather than rescan on every load
    }

    const stranded = (await storage.getSessions()).filter(
      (s) =>
        !s.endedAt &&
        s.measures?.length &&
        // Not the session this page is playing, and not one another tab is:
        // its row looks identical to a stranded one until it ends. Anything
        // still being played has a recent attempt, so age tells them apart —
        // and closing a live session would credit it here and again when its
        // own tab finishes.
        s.id !== currentSession?.id &&
        Date.now() - getLastMeasureEndTime(s).getTime() > STRANDED_MIN_AGE_MS
    )
    for (const session of stranded) {
      const closed = { ...session, endedAt: getLastMeasureEndTime(session).toISOString() }
      await storage.saveSession(closed)
      // No meta: the aggregate keeps whatever title it already has, and every
      // stranded session belongs to a score that has been played properly since.
      await updateAggregates(closed)
    }

    try {
      localStorage.setItem(STRANDED_REPAIR_KEY, '1')
    } catch {
      /* ignore: the filter above keeps a re-run harmless anyway */
    }
    if (stranded.length) console.info(`Closed ${stranded.length} interrupted session(s) from before the fix.`)
  }

  // Recompute every aggregate from scratch by replaying all stored sessions in
  // chronological order. Used after cloud sync pulls sessions from another
  // device. `metaFor(scoreId)` supplies { title, composer } from the catalog —
  // pass one: sessions don't carry the title, so rebuilding without it leaves
  // every aggregate untitled and the practice journal shows "Untitled"
  // throughout. fetchCatalogMeta() in sync.js builds a suitable map.
  async function rebuildAggregates(metaFor = () => null) {
    const sessions = await storage.getSessions()
    sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
    await storage.clearAggregates()
    for (const session of sessions) {
      if (!session.measures || session.measures.length === 0) continue
      // Only ended sessions were ever credited by endSession(), and only they
      // are pushed to the cloud (see sync.js) — so replaying an unfinished one
      // would invent practice time no other device can see. They do pile up:
      // measure attempts save incrementally, and beforeunload's endSession()
      // can be abandoned before it commits (see endMeasureAttempt).
      if (!session.endedAt) continue
      // Ended but not yet aggregated: endSession() saves the session, then
      // credits it. A sync landing between the two would count it twice.
      if (session.id === currentSession?.id) continue
      await updateAggregates(session, metaFor(session.scoreId))
    }
  }

  async function getAllPlaythroughs(scoreId) {
    const history = await getScoreHistory(scoreId)
    return history.flatMap((day) => day.fullPlaythroughs)
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  function startSession(scoreId, scoreTitle, composer, mode, totalMeasures = null) {
    if (!scoreId) return null

    // Store metadata separately (used for updating aggregates, not stored in session)
    currentScoreTitle = scoreTitle || null
    currentComposer = composer || null
    aggregateTitleEnsured = false

    const now = new Date().toISOString()
    currentSession = {
      id: generateId(),
      scoreId,
      totalMeasures: totalMeasures || null,
      mode,
      startedAt: now,
      playthroughStartedAt: null,
      endedAt: null,
      measures: [],
    }
    return currentSession
  }

  async function toggleMode(newMode) {
    if (!currentSession) return null

    const { scoreId, totalMeasures } = currentSession
    // Preserve metadata from instance variables
    const scoreTitle = currentScoreTitle
    const composer = currentComposer
    await endSession()
    return startSession(scoreId, scoreTitle, composer, newMode, totalMeasures)
  }

  // `startsPlaythrough` says this measure is where a run through the whole score
  // begins. Usually the first one, but not always: with one hand unticked the
  // score can open on a bar that hand rests through, and the cursor starts after
  // it — the score page knows which measure that is, the tracker doesn't.
  function startMeasureAttempt(sourceMeasureIndex, startsPlaythrough = sourceMeasureIndex === 0, activeHands = { right: true, left: true }) {
    if (!currentSession) return null

    if (startsPlaythrough && !currentSession.playthroughStartedAt) {
      currentSession.playthroughStartedAt = new Date().toISOString()
    }

    currentMeasureAttempt = {
      sourceMeasureIndex,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      wrongNotes: 0,
      clean: true,
      hands: handsKey(activeHands),
    }
    return currentMeasureAttempt
  }

  function recordWrongNote() {
    if (!currentMeasureAttempt) return
    currentMeasureAttempt.wrongNotes++
    currentMeasureAttempt.clean = false
  }

  async function endMeasureAttempt(clean = null) {
    if (!currentSession || !currentMeasureAttempt) return null

    const startTime = new Date(currentMeasureAttempt.startedAt).getTime()
    currentMeasureAttempt.durationMs = Date.now() - startTime

    if (clean !== null) {
      currentMeasureAttempt.clean = clean
    }

    const completedAttempt = { ...currentMeasureAttempt }
    currentMeasureAttempt = null
    fileAttempt(completedAttempt)
    return completedAttempt
  }

  // An attempt the caller timed itself, filed as if it had been played through
  // startMeasureAttempt/endMeasureAttempt. Strict mode is the caller: its runs
  // are driven by the metronome rather than by the notes played, so a measure's
  // verdict is only settled once its last off-tempo window has closed — well
  // after the measure itself is over. The engine hands over the whole run at
  // the end, each measure already timed from the tempo it was played at.
  function recordMeasureAttempt({ sourceMeasureIndex, startedAt, durationMs, wrongNotes = 0, clean = true, hands = TWO_HANDS }) {
    if (!currentSession) return null
    const attempt = { sourceMeasureIndex, startedAt, durationMs, wrongNotes, clean, hands }
    fileAttempt(attempt)
    return attempt
  }

  // Appends a finished attempt to the session under way and persists it.
  function fileAttempt(attempt) {
    let measureEntry = currentSession.measures.find(
      (m) => m.sourceMeasureIndex === attempt.sourceMeasureIndex
    )

    if (!measureEntry) {
      measureEntry = { sourceMeasureIndex: attempt.sourceMeasureIndex, attempts: [] }
      currentSession.measures.push(measureEntry)
    }

    measureEntry.attempts.push({
      startedAt: attempt.startedAt,
      durationMs: attempt.durationMs,
      wrongNotes: attempt.wrongNotes,
      clean: attempt.clean,
      hands: attempt.hands,
    })

    // Save session incrementally (don't await - fire and forget)
    storage.saveSession({ ...currentSession })

    // Full aggregate stats (totalSessions, measures, practice time) are only
    // ever accumulated once, in endSession(). But endSession() only reliably
    // runs on unload via beforeunload, whose async work can be abandoned
    // before the IndexedDB write commits if the user navigates away without
    // finishing the piece - leaving no aggregate row at all, and the library's
    // practice journal (which reads scoreTitle/composer from aggregates)
    // showing "Untitled". Ensure the title/composer land early and cheaply,
    // without touching the stats that endSession() is responsible for.
    ensureAggregateTitle(currentSession.scoreId, currentScoreTitle, currentComposer)
  }

  function markScoreCompleted() {
    if (!currentSession) return
    currentSession.completedAt = new Date().toISOString()
  }

  // `at` (an ISO string) dates the restart, for a caller that knows when the
  // run began better than the moment it tells us about it — strict mode files
  // its run once it is over.
  function restartPlaythrough(at = new Date().toISOString()) {
    if (!currentSession) return
    currentSession.playthroughStartedAt = at
  }

  async function endSession() {
    if (!currentSession) return null

    currentSession.endedAt = new Date().toISOString()

    const sessionToSave = { ...currentSession }

    // Don't save sessions with no completed measures
    if (sessionToSave.measures.length > 0) {
      await storage.saveSession(sessionToSave)
      await updateAggregates(sessionToSave)
    }
    // Committed: whatever a pagehide stashed for *this* session is redundant.
    clearPendingSession(sessionToSave.id)
    // The session just left the "live" slot for the stored history the
    // reinforcement window reads, so that window has to be read again.
    invalidateReinforcementSessions()

    currentSession = null
    currentMeasureAttempt = null
    return sessionToSave
  }

  // Shared skeleton for a brand-new aggregate row (used both here and in
  // updateAggregates(), which layers session-derived fields on top).
  function createDefaultAggregate(scoreId) {
    return {
      scoreId,
      status: 'dechiffrage',
      totalSessions: 0,
      totalPracticeTimeMs: 0,
      timesCompleted: 0,
      timesCompletedOneHand: 0,
      practiceDays: [],
      measures: {},
    }
  }

  // Cheap, idempotent title/composer upsert — see the call site in
  // endMeasureAttempt() for why this can't just be an early call to
  // updateAggregates(), which accumulates stats and must run exactly once.
  // Skips the IndexedDB round-trip once a session has already ensured it.
  async function ensureAggregateTitle(scoreId, title, composer) {
    if (aggregateTitleEnsured || (!title && !composer)) return

    const aggregate = (await storage.getAggregate(scoreId)) || createDefaultAggregate(scoreId)

    if (aggregate.scoreTitle && aggregate.composer) {
      aggregateTitleEnsured = true
      return
    }

    if (title) aggregate.scoreTitle = title
    if (composer) aggregate.composer = composer
    await storage.saveAggregate(aggregate)
    aggregateTitleEnsured = true
  }

  // `meta` ({ title, composer }) overrides the live-session metadata — used when
  // rebuilding aggregates from synced sessions, whose title/composer come from
  // the score catalog rather than the current playing session.
  async function updateAggregates(session, meta = null) {
    const title = meta?.title ?? currentScoreTitle
    const composer = meta?.composer ?? currentComposer

    let aggregate = await storage.getAggregate(session.scoreId)

    if (!aggregate) {
      aggregate = {
        ...createDefaultAggregate(session.scoreId),
        scoreTitle: title,
        composer,
        firstPlayedAt: session.startedAt,
        lastPlayedAt: session.endedAt,
      }
    }

    // Always sync title/composer when known
    if (title) {
      aggregate.scoreTitle = title
    }
    if (composer) {
      aggregate.composer = composer
    }

    const lastMeasureEndTime = getLastMeasureEndTime(session)
    aggregate.lastPlayedAt = lastMeasureEndTime.toISOString()
    aggregate.totalSessions++

    if (!aggregate.timesCompleted) aggregate.timesCompleted = 0
    if (!aggregate.timesCompletedOneHand) aggregate.timesCompletedOneHand = 0
    if (session.completedAt) {
      // Playing the piece through with one hand is real work, but it is not
      // the piece played in full — it gets its own counter, and leaves the
      // "last played in full" date and the status thresholds alone.
      if (playedInFull(session)) {
        aggregate.timesCompleted++
        aggregate.lastCompletedAt = session.completedAt
      } else {
        aggregate.timesCompletedOneHand++
      }
    }

    if (!aggregate.practiceDays) aggregate.practiceDays = []
    const sessionDay = session.startedAt.substring(0, 10)
    if (!aggregate.practiceDays.includes(sessionDay)) {
      aggregate.practiceDays.push(sessionDay)
    }

    const sessionDuration = computeSessionDuration(session)
    aggregate.totalPracticeTimeMs += sessionDuration

    for (const measureData of session.measures) {
      const measureIndex = measureData.sourceMeasureIndex
      if (!aggregate.measures[measureIndex]) {
        aggregate.measures[measureIndex] = {
          totalAttempts: 0,
          cleanAttempts: 0,
          totalDurationMs: 0,
          lastPlayedAt: null,
        }
      }

      const measureAgg = aggregate.measures[measureIndex]
      for (const attempt of measureData.attempts) {
        measureAgg.totalAttempts++
        if (attempt.clean) {
          measureAgg.cleanAttempts++
        }
        measureAgg.totalDurationMs += attempt.durationMs
        measureAgg.lastPlayedAt = attempt.startedAt
      }

      measureAgg.avgDurationMs = Math.round(measureAgg.totalDurationMs / measureAgg.totalAttempts)
      measureAgg.errorRate =
        measureAgg.totalAttempts > 0
          ? (measureAgg.totalAttempts - measureAgg.cleanAttempts) / measureAgg.totalAttempts
          : 0
    }

    aggregate.status = computeScoreStatus(aggregate)

    await storage.saveAggregate(aggregate)
    return aggregate
  }

  function computeScoreStatus(aggregate) {
    const measureValues = Object.values(aggregate.measures)
    if (measureValues.length === 0) return 'dechiffrage'

    const measuresWithEnoughClean = measureValues.filter((m) => m.cleanAttempts >= 3).length
    const measuresWithMasteryClean = measureValues.filter((m) => m.cleanAttempts >= 10).length

    const totalMeasures = measureValues.length
    const enoughCleanRatio = measuresWithEnoughClean / totalMeasures
    const masteryCleanRatio = measuresWithMasteryClean / totalMeasures

    const repertoireReady =
      masteryCleanRatio === 1 &&
      (aggregate.practiceDays || []).length >= 3 &&
      (aggregate.timesCompleted || 0) >= 10
    if (repertoireReady) return 'repertoire'

    if (enoughCleanRatio >= 0.5 && aggregate.timesCompleted > 0) {
      return 'perfectionnement'
    }

    return 'dechiffrage'
  }

  async function getScoreStats(scoreId) {
    return storage.getAggregate(scoreId)
  }

  // Measures worth reinforcing right now. Reads the score's recent history —
  // the session under way included — so the suggestion is there as soon as a
  // measure has been fumbled, without waiting for the piece to be played from
  // end to end: on a long score, the first half gets worked on long before the
  // rest has even been sight-read.
  async function getMeasuresToReinforce(scoreId, limit = 5) {
    if (!scoreId) return []
    return rankMeasuresToReinforce(await recentSessions(scoreId), limit)
  }

  // The window of sessions the suggestions look at, oldest first, with the
  // in-memory session substituted for the copy endMeasureAttempt saved: that
  // one is a measure behind by construction.
  //
  // Sessions are re-read from storage only when the score changes or a session
  // is closed, because this runs at every measure boundary and getSessions()
  // deserializes the score's whole history.
  async function recentSessions(scoreId) {
    if (reinforcementSessions.scoreId !== scoreId) {
      reinforcementSessions = { scoreId, sessions: await storage.getSessions(scoreId) }
    }

    const live = currentSession?.scoreId === scoreId ? currentSession : null
    const sessions = reinforcementSessions.sessions.filter((s) => s.id !== live?.id)
    if (live) sessions.push(live)
    sessions.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    return sessions.slice(-REINFORCEMENT_WINDOW_SESSIONS)
  }

  function invalidateReinforcementSessions() {
    reinforcementSessions = { scoreId: null, sessions: [] }
  }

  // Ranks the fumbled measures of a run of sessions (oldest first), stagnating
  // ones ahead of the rest: those are the passages practice has stopped paying
  // off on, and the reason to look past the last session at all.
  function rankMeasuresToReinforce(sessions, limit = 5) {
    const candidates = []

    for (const { sourceMeasureIndex, bySession } of measureHistories(sessions)) {
      const attempts = bySession.flat()
      const wrongNotes = attempts.reduce((sum, a) => sum + (a.wrongNotes || 0), 0)
      if (!attempts.some(fumbled)) continue
      // Settled: the measure has since been played cleanly as many times in a
      // row as reinforcement mode itself demands to call it done.
      if (cleanStreak(attempts) >= REINFORCEMENT_CLEAN_STREAK) continue

      candidates.push({
        sourceMeasureIndex,
        wrongNotes,
        durationMs: attempts[attempts.length - 1].durationMs || 0,
        stagnant: isStagnant(bySession),
      })
    }

    return candidates
      .sort(
        (a, b) =>
          Number(b.stagnant) - Number(a.stagnant) ||
          b.wrongNotes - a.wrongNotes ||
          b.durationMs - a.durationMs
      )
      .slice(0, limit)
  }

  // Attempts per measure across the given sessions, kept grouped by session:
  // the totals answer "how badly", the grouping answers "is it getting better".
  function measureHistories(sessions) {
    const histories = new Map()

    for (const session of sessions) {
      for (const measure of session.measures || []) {
        if (!measure.attempts?.length) continue
        let history = histories.get(measure.sourceMeasureIndex)
        if (!history) {
          history = { sourceMeasureIndex: measure.sourceMeasureIndex, bySession: [] }
          histories.set(measure.sourceMeasureIndex, history)
        }
        history.bySession.push(measure.attempts)
      }
    }

    return [...histories.values()]
  }

  // A wrong note always fails the attempt, but the matcher can fail one on its
  // own (a missed note ends the measure unclean without recording anything).
  function fumbled(attempt) {
    return attempt.clean === false || (attempt.wrongNotes || 0) > 0
  }

  function cleanStreak(attempts) {
    let streak = 0
    for (let i = attempts.length - 1; i >= 0 && !fumbled(attempts[i]); i--) streak++
    return streak
  }

  // Stagnation is the trend over sessions, not within one: a measure stagnates
  // when the error rate of its recent sessions is no better than that of the
  // earlier ones. Below STAGNATION_MIN_SESSIONS there is no trend to read, only
  // the noise of a good day and a bad one.
  function isStagnant(bySession) {
    if (bySession.length < STAGNATION_MIN_SESSIONS) return false
    const rates = bySession.map((attempts) => attempts.filter(fumbled).length / attempts.length)
    const split = Math.floor(rates.length / 2)
    return mean(rates.slice(split)) >= mean(rates.slice(0, split))
  }

  function mean(values) {
    return values.reduce((sum, v) => sum + v, 0) / values.length
  }

  function getFullPlaythroughs(sessions, totalMeasures) {
    if (!totalMeasures) return []

    const playthroughs = []
    for (const session of sessions) {
      if (!session.completedAt || !session.playthroughStartedAt) continue

      const { start, end } = playthroughWindow(session)
      const attempts = sessionAttempts(session, start, end)
      playthroughs.push({
        startedAt: session.playthroughStartedAt,
        durationMs: playthroughDuration(attempts, start, end),
        hands: playthroughHands(attempts),
      })
    }

    // Sort by start time descending (most recent first)
    playthroughs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    return playthroughs
  }

  // When the player last played in this session, falling back to its start when
  // no attempt carries usable timing.
  function getLastMeasureEndTime(session) {
    const attempts = sessionAttempts(session)
    return attempts.length > 0 ? new Date(lastAttemptEnd(attempts)) : new Date(session.startedAt)
  }

  // One row per practised day, keyed by local day ('YYYY-MM-DD'), for the
  // year-at-a-glance calendar. Days with no practice are simply absent.
  //
  // getDailyLogs() already groups sessions by day, but it answers a much richer
  // question — which scores, which measures, how many full playthroughs, with
  // an aggregate lookup per score — and its cost grows with the number of days
  // asked for. A year of coloured squares needs one duration per day, so this
  // walks the sessions once and keeps only what a square and its tooltip show.
  async function getPracticeCalendar() {
    const byDay = new Map()
    for (const session of await storage.getSessions()) {
      const key = localDayKey(session.startedAt)
      if (!byDay.has(key)) byDay.set(key, { practiceTimeMs: 0, timesPlayedInFull: 0 })
      const day = byDay.get(key)
      day.practiceTimeMs += computeSessionDuration(session)
      if (playedInFull(session)) day.timesPlayedInFull += 1
    }
    return byDay
  }

  async function getDailyLog(date) {
    return (await getDailyLogs([date]))[0]
  }

  // The journal asks for a run of consecutive days at once. Reading them one at
  // a time means one storage.getSessions() per day, and that has no index on
  // startedAt: it cursors the whole store and filters in JS, so every extra day
  // deserializes every session again. One read for the whole span instead, with
  // the aggregate lookups shared across days.
  async function getDailyLogs(dates) {
    if (dates.length === 0) return []

    const bounds = dates.map((d) => new Date(d).setHours(0, 0, 0, 0))
    const start = new Date(Math.min(...bounds))
    const end = new Date(Math.max(...bounds))
    end.setHours(23, 59, 59, 999)

    const sessions = await storage.getSessions(null, { start, end })
    const byDay = new Map()
    for (const session of sessions) {
      const key = localDayKey(session.startedAt)
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key).push(session)
    }

    const aggregates = new Map()
    const logs = []
    for (const date of dates) {
      logs.push(await buildDailyLog(byDay.get(localDayKey(date)) ?? [], aggregates))
    }
    return logs
  }

  // `aggregateCache` is shared across the days of one journal read: the same
  // score shows up on many days and its aggregate never changes mid-read.
  async function buildDailyLog(sessions, aggregateCache) {
    const scoreMap = new Map()

    for (const session of sessions) {
      if (!scoreMap.has(session.scoreId)) {
        // Look up metadata from aggregate (single source of truth)
        if (!aggregateCache.has(session.scoreId)) {
          aggregateCache.set(session.scoreId, await storage.getAggregate(session.scoreId))
        }
        const aggregate = aggregateCache.get(session.scoreId)

        scoreMap.set(session.scoreId, {
          scoreId: session.scoreId,
          scoreTitle: aggregate?.scoreTitle || null,
          composer: aggregate?.composer || null,
          totalMeasures: null,
          sessions: [],
          measuresWorked: new Set(),
          measuresReinforced: new Set(),
          totalPracticeTimeMs: 0,
          lastPlayedAt: null,
        })
      }

      const entry = scoreMap.get(session.scoreId)
      entry.sessions.push(session)

      if (session.totalMeasures) {
        entry.totalMeasures = session.totalMeasures
      }

      const sessionDuration = computeSessionDuration(session)
      entry.totalPracticeTimeMs += sessionDuration

      const sessionLastPlayedAt = getLastMeasureEndTime(session)
      if (!entry.lastPlayedAt || sessionLastPlayedAt > entry.lastPlayedAt) {
        entry.lastPlayedAt = sessionLastPlayedAt
      }

      for (const measure of session.measures) {
        const measureIndex = Number(measure.sourceMeasureIndex)
        entry.measuresWorked.add(measureIndex)
        if (session.mode === 'training') {
          entry.measuresReinforced.add(measureIndex)
        }
      }
    }

    return Array.from(scoreMap.values())
      .map(withPlaythroughs)
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  }

  // The tail both groupings share: the sets they filled become sorted arrays,
  // and their sessions become the runs through the whole score they hold.
  // `timesPlayedInFull` stays what it says — the two-handed ones.
  function withPlaythroughs(entry) {
    const fullPlaythroughs = getFullPlaythroughs(entry.sessions, entry.totalMeasures)
    return {
      ...entry,
      measuresWorked: Array.from(entry.measuresWorked).sort((a, b) => a - b),
      measuresReinforced: Array.from(entry.measuresReinforced).sort((a, b) => a - b),
      fullPlaythroughs,
      timesPlayedInFull: fullPlaythroughs.filter((pt) => pt.hands === TWO_HANDS).length,
    }
  }

  async function getScoreHistory(scoreId) {
    const sessions = await storage.getSessions(scoreId)

    // Group sessions by date
    const dateMap = new Map()

    for (const session of sessions) {
      const dateKey = session.startedAt.substring(0, 10)

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          sessions: [],
          measuresWorked: new Set(),
          measuresReinforced: new Set(),
          totalPracticeTimeMs: 0,
          totalMeasures: null,
          lastPlayedAt: null,
        })
      }

      const entry = dateMap.get(dateKey)
      entry.sessions.push(session)

      if (session.totalMeasures) {
        entry.totalMeasures = session.totalMeasures
      }

      const sessionDuration = computeSessionDuration(session)
      entry.totalPracticeTimeMs += sessionDuration

      const sessionLastPlayedAt = getLastMeasureEndTime(session)
      if (!entry.lastPlayedAt || sessionLastPlayedAt > entry.lastPlayedAt) {
        entry.lastPlayedAt = sessionLastPlayedAt
      }

      for (const measure of session.measures) {
        const measureIndex = Number(measure.sourceMeasureIndex)
        entry.measuresWorked.add(measureIndex)
        if (session.mode === 'training') {
          entry.measuresReinforced.add(measureIndex)
        }
      }
    }

    return Array.from(dateMap.values())
      .map(withPlaythroughs)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  async function getAllScores() {
    return storage.getAllAggregates()
  }
}
