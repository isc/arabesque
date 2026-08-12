import { initStorage } from './storage.js'

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

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// Measure attempts overlapping [start, end], in chronological order. Defaults
// to every attempt in the session.
function attemptIntervals(session, start = -Infinity, end = Infinity) {
  const intervals = []
  for (const measure of session.measures || []) {
    for (const attempt of measure.attempts || []) {
      if (!attempt.startedAt) continue
      const s = new Date(attempt.startedAt).getTime()
      const durationMs = attempt.durationMs || 0
      if (s + durationMs > start && s < end) {
        intervals.push({ start: s, durationMs })
      }
    }
  }
  return intervals.sort((a, b) => a.start - b.start)
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

// A completed playthrough, timed from when the player started it to when they
// finished. Falls back to raw wall-clock when per-measure timing is unavailable.
export function computePlaythroughDuration(session) {
  const start = new Date(session.playthroughStartedAt).getTime()
  const end = new Date(session.completedAt).getTime()
  const intervals = attemptIntervals(session, start, end)
  if (intervals.length === 0) return end - start
  return normalizedPlayingTime(intervals, start, end)
}

// Practice time credited to a session: first measure attempt to last, minus
// interruptions. It has to go through the same normalization as a playthrough —
// on a raw span, a score left open on the desk counts in full, and a single
// 79-minute attempt on one measure once turned ten minutes of practice into
// 1h33 in the journal.
export function computeSessionDuration(session) {
  const intervals = attemptIntervals(session)
  if (intervals.length === 0) return 0
  return normalizedPlayingTime(intervals, intervals[0].start, lastAttemptEnd(intervals))
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

  return {
    init: () => storage.init(),
    startSession,
    toggleMode,
    startMeasureAttempt,
    recordWrongNote,
    endMeasureAttempt,
    markScoreCompleted,
    restartPlaythrough,
    endSession,
    getScoreStats,
    analyzeMeasuresFromSession,
    getLastCompletedSession,
    getDailyLog,
    getScoreHistory,
    getAllPlaythroughs,
    getAllScores,
    computeScoreStatus,
    rebuildAggregates,
    getCurrentSession: () => currentSession,
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

  function startMeasureAttempt(sourceMeasureIndex) {
    if (!currentSession) return null

    // Set playthroughStartedAt when user starts playing from measure 0
    if (sourceMeasureIndex === 0 && !currentSession.playthroughStartedAt) {
      currentSession.playthroughStartedAt = new Date().toISOString()
    }

    currentMeasureAttempt = {
      sourceMeasureIndex,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      wrongNotes: 0,
      clean: true,
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

    let measureEntry = currentSession.measures.find(
      (m) => m.sourceMeasureIndex === currentMeasureAttempt.sourceMeasureIndex
    )

    if (!measureEntry) {
      measureEntry = {
        sourceMeasureIndex: currentMeasureAttempt.sourceMeasureIndex,
        attempts: [],
      }
      currentSession.measures.push(measureEntry)
    }

    measureEntry.attempts.push({
      startedAt: currentMeasureAttempt.startedAt,
      durationMs: currentMeasureAttempt.durationMs,
      wrongNotes: currentMeasureAttempt.wrongNotes,
      clean: currentMeasureAttempt.clean,
    })

    const completedAttempt = { ...currentMeasureAttempt }
    currentMeasureAttempt = null

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

    return completedAttempt
  }

  function markScoreCompleted() {
    if (!currentSession) return
    currentSession.completedAt = new Date().toISOString()
  }

  function restartPlaythrough() {
    if (!currentSession) return
    currentSession.playthroughStartedAt = new Date().toISOString()
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
    if (session.completedAt) {
      aggregate.timesCompleted++
      aggregate.lastCompletedAt = session.completedAt
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

  function analyzeMeasuresFromSession(session, limit = 5) {
    if (!session?.measures?.length) return []

    const measureStats = session.measures.map((measure) => {
      const lastAttempt = measure.attempts[measure.attempts.length - 1]
      const totalWrongNotes = measure.attempts.reduce((sum, a) => sum + a.wrongNotes, 0)
      return {
        sourceMeasureIndex: measure.sourceMeasureIndex,
        wrongNotes: totalWrongNotes,
        durationMs: lastAttempt?.durationMs || 0,
      }
    })

    // Filter measures with errors, sort by nb errors then duration
    return measureStats
      .filter((m) => m.wrongNotes > 0)
      .sort((a, b) => b.wrongNotes - a.wrongNotes || b.durationMs - a.durationMs)
      .slice(0, limit)
  }

  async function getLastCompletedSession(scoreId) {
    const sessions = await storage.getSessions(scoreId)
    const completed = sessions.filter((s) => s.completedAt)
    if (completed.length === 0) return null
    // Sort by completedAt descending and return the most recent
    completed.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    return completed[0]
  }

  function countFullPlaythroughs(sessions, totalMeasures) {
    return getFullPlaythroughs(sessions, totalMeasures).length
  }

  function getFullPlaythroughs(sessions, totalMeasures) {
    if (!totalMeasures) return []

    const playthroughs = []
    for (const session of sessions) {
      if (!session.completedAt || !session.playthroughStartedAt) continue

      playthroughs.push({
        startedAt: session.playthroughStartedAt,
        durationMs: computePlaythroughDuration(session),
      })
    }

    // Sort by start time descending (most recent first)
    playthroughs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    return playthroughs
  }

  // When the player last played in this session, falling back to its start when
  // no attempt carries usable timing.
  function getLastMeasureEndTime(session) {
    const intervals = attemptIntervals(session)
    return intervals.length > 0 ? new Date(lastAttemptEnd(intervals)) : new Date(session.startedAt)
  }

  async function getDailyLog(date) {
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)

    const sessions = await storage.getSessions(null, {
      start: startOfDay,
      end: endOfDay,
    })

    const scoreMap = new Map()

    for (const session of sessions) {
      if (!scoreMap.has(session.scoreId)) {
        // Look up metadata from aggregate (single source of truth)
        const aggregate = await storage.getAggregate(session.scoreId)

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
      .map((entry) => ({
        ...entry,
        measuresWorked: Array.from(entry.measuresWorked).sort((a, b) => a - b),
        measuresReinforced: Array.from(entry.measuresReinforced).sort((a, b) => a - b),
        timesPlayedInFull: countFullPlaythroughs(entry.sessions, entry.totalMeasures),
      }))
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
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
      .map((entry) => {
        const fullPlaythroughs = getFullPlaythroughs(entry.sessions, entry.totalMeasures)
        return {
          ...entry,
          measuresWorked: Array.from(entry.measuresWorked).sort((a, b) => a - b),
          measuresReinforced: Array.from(entry.measuresReinforced).sort((a, b) => a - b),
          timesPlayedInFull: fullPlaythroughs.length,
          fullPlaythroughs,
        }
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  async function getAllScores() {
    return storage.getAllAggregates()
  }
}
