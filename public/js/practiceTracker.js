import { initStorage } from './storage.js'
import { TWO_HANDS, handsKey } from './hands.js'
import { scopedKey } from './profiles.js'
import { localDayKey, shiftDayKey, startOfLocalDay, byStartedAt, sessionDay } from './days.js'
import { loadCatalog } from './catalog.js'
import { getFullPlaythroughs, getLastMeasureEndTime, sessionAttempts } from './practiceTime.js'
import { measuresToReinforce } from './reinforcement.js'
import {
  AGGREGATES_VERSION,
  applyName,
  createDefaultAggregate,
  foldSession,
  knownNames,
  titleOf,
} from './aggregates.js'
import { buildDailyLog, buildPracticeCalendar, buildScoreHistory } from './practiceJournal.js'

// Where a session interrupted by a page teardown waits to be closed properly
// (see stashPendingSession). The profile's own: the snapshot must be replayed
// into the database the session came from, whoever opens the app next.
export const PENDING_SESSION_KEY = scopedKey('arabesque:pending-session')

// Marks the one-off repair of sessions stranded before those snapshots existed
// (see closeStrandedSessions). Per profile like the database it speaks of.
export const STRANDED_REPAIR_KEY = scopedKey('arabesque:stranded-sessions-closed')

// How quiet a session must be before the repair treats it as abandoned rather
// than in progress somewhere else. Well beyond any gap between two measures,
// and the sessions this exists for are months old.
const STRANDED_MIN_AGE_MS = 60 * 60 * 1000

export function initPracticeTracker(storageInstance = null) {
  const storage = storageInstance || initStorage()

  let currentSession = null
  let currentMeasureAttempt = null
  // Set once ensureAggregateTitle() has written title/composer for the
  // current session, so later measures skip the IndexedDB round-trip.
  let aggregateTitleEnsured = false
  // One score's stored sessions, kept between reads (see scoreSessions).
  let sessionCache = { scoreId: null, sessions: [] }

  return {
    // Outdated rows are rebuilt before anything is folded into them: the fold
    // counts on the row's current shape (its practice days, its counters).
    // The rebuild replays ended sessions only, so what the two steps after it
    // close is folded once, by them.
    init: async () => {
      await storage.init()
      await rebuildOutdatedAggregates()
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
    recordStrictRun,
    markScoreCompleted,
    restartPlaythrough,
    setActiveHands,
    endSession,
    getScoreStats,
    getMeasuresToReinforce,
    getDailyLog,
    getDailyLogs,
    getPracticeCalendar,
    getScoreHistory,
    getAllPlaythroughs,
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
        JSON.stringify({ session: { ...currentSession, endedAt: new Date().toISOString() } })
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

    const { session } = pending ?? {}
    if (session?.id && session.measures?.length) {
      const stored = await storage.getSession(session.id)
      if (!stored?.endedAt) {
        await storage.saveSession(session)
        await updateAggregates(session)
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
      // No title to give: the aggregate keeps whatever it already has, and
      // every stranded session belongs to a score played properly since.
      await updateAggregates(closed, {})
    }

    try {
      localStorage.setItem(STRANDED_REPAIR_KEY, '1')
    } catch {
      /* ignore: the filter above keeps a re-run harmless anyway */
    }
    if (stranded.length) console.info(`Closed ${stranded.length} interrupted session(s) from before the fix.`)
  }

  // Replays the sessions when a stored row was counted by other rules than
  // AGGREGATES_VERSION.
  async function rebuildOutdatedAggregates() {
    const aggregates = await storage.getAllAggregates()
    if (aggregates.some((a) => a.rulesVersion !== AGGREGATES_VERSION)) await rebuildAggregates()
  }

  // Recompute every aggregate from scratch by replaying all stored sessions in
  // chronological order. Used after sessions arrive from elsewhere — a sync's
  // pull, a backup's import — and when the rules change (see
  // AGGREGATES_VERSION). `fallbackNames` (scoreId → { title, composer }) are
  // names to fall back on below every other, as an imported backup's
  // aggregates offer.
  //
  // Folded in memory and written in one transaction: a replay walks every
  // session ever played, and a read and a write per session made it seconds
  // long on WebKit, during which a page closed left the aggregates half built.
  async function rebuildAggregates(fallbackNames = new Map()) {
    // The sessions that arrived are missing from the cached ones too.
    dropSessionCache()
    const [sessions, aggregates] = await Promise.all([storage.getSessions(), storage.getAllAggregates()])
    sessions.sort(byStartedAt)
    // What the aggregates already knew, before they are thrown away — all a
    // session stored before sessions carried their own name can offer. Only
    // a row that has a name: an untitled one would hide the fallback's.
    const known = knownNames(aggregates)
    // Where a replayed session gets its name: its own record, then the
    // snapshot, then the fallback. A score the catalog lists is shown under
    // the catalog's name whatever is stored (getDailyLogs), so these names are
    // for the others — a file the player opened from disk, a score added since
    // this device cached data/scores.json — which the rebuild used to leave
    // untitled for good (feedback 401b88bf).
    const nameFor = (session) =>
      (session.scoreTitle ? titleOf(session) : null) ??
      known.get(session.scoreId) ??
      fallbackNames.get(session.scoreId) ??
      {}
    const rebuilt = new Map()
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
      rebuilt.set(session.scoreId, foldSession(rebuilt.get(session.scoreId), session, nameFor(session)))
    }
    await storage.replaceAggregates([...rebuilt.values()])
  }

  // Every run through the score, most recent first: the ranking at the end of
  // a piece. Off the sessions the reinforcement suggestions read, which the
  // end of a piece asks for next — one read of the score's history, not two.
  async function getAllPlaythroughs(scoreId) {
    return getFullPlaythroughs(await scoreSessions(scoreId))
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  function startSession(scoreId, scoreTitle, composer, mode, totalMeasures = null) {
    if (!scoreId) return null

    aggregateTitleEnsured = false

    const now = new Date().toISOString()
    currentSession = {
      id: generateId(),
      scoreId,
      // The score's name travels with the session that played it. Aggregates
      // are what the journal reads, and a sync throws them away and rebuilds
      // them from the sessions — so a session that names nothing can only be
      // re-titled from this device's catalog, which does not hold a file
      // opened from disk, nor a score added since the catalog was cached
      // (feedback 401b88bf). Sessions push to the cloud as they are, so this
      // reaches the other devices too.
      scoreTitle: scoreTitle || null,
      composer: composer || null,
      totalMeasures: totalMeasures || null,
      mode,
      startedAt: now,
      playthroughStartedAt: null,
      endedAt: null,
      measures: [],
    }
    return currentSession
  }

  // Hands the score on to a session under `newMode`, closing the one under way.
  // Resolves with whether that one was filed — whether anything was played in
  // it — which is what makes it worth a sync.
  async function toggleMode(newMode) {
    if (!currentSession) return false
    // Nothing recorded yet: the session just changes hands. Ending it would
    // drop it anyway, and would throw away the cached sessions for nothing
    // (see scoreSessions).
    if (currentSession.measures.length === 0 && !currentMeasureAttempt) {
      currentSession.mode = newMode
      return false
    }

    const { scoreId, scoreTitle, composer, totalMeasures } = currentSession
    const ended = await endSession()
    startSession(scoreId, scoreTitle, composer, newMode, totalMeasures)
    return isWorthFiling(ended)
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

  // Closes the attempt with its own verdict: clean unless recordWrongNote() was
  // called since it opened. An attempt is one measure's, not the passage's: a
  // fumble in the third bar of a passage spoils the repetition, but the first
  // two were played clean, and the journal — and the measures it suggests
  // reinforcing — go on saying so.
  async function endMeasureAttempt() {
    if (!currentSession || !currentMeasureAttempt) return null

    const startTime = new Date(currentMeasureAttempt.startedAt).getTime()
    currentMeasureAttempt.durationMs = Date.now() - startTime

    const completedAttempt = { ...currentMeasureAttempt }
    currentMeasureAttempt = null
    recordMeasureAttempt(completedAttempt)
    return completedAttempt
  }

  // Appends a finished attempt to the session under way and persists it. The
  // caller timed the attempt itself, which is how strict mode files a run: it
  // is driven by the metronome rather than by the notes played, so a measure's
  // verdict is only settled once its last off-tempo window has closed — well
  // after the measure itself is over — and the whole run is handed over at the
  // end, each measure already timed from the tempo it was played at.
  //
  // `persist` skips the incremental save when the caller commits the session
  // itself right after: filing a whole run would otherwise write the session,
  // growing as it goes, once per measure.
  function recordMeasureAttempt(
    { sourceMeasureIndex, startedAt, durationMs, wrongNotes = 0, clean = true, hands = TWO_HANDS },
    { persist = true } = {}
  ) {
    if (!currentSession) return
    let measureEntry = currentSession.measures.find((m) => m.sourceMeasureIndex === sourceMeasureIndex)

    if (!measureEntry) {
      measureEntry = { sourceMeasureIndex, attempts: [] }
      currentSession.measures.push(measureEntry)
    }

    measureEntry.attempts.push({ startedAt, durationMs, wrongNotes, clean, hands })

    // Save session incrementally (don't await - fire and forget)
    if (persist) storage.saveSession({ ...currentSession })

    // Full aggregate stats (totalSessions, measures, practice time) are only
    // ever accumulated once, in endSession(). But endSession() only reliably
    // runs on unload via beforeunload, whose async work can be abandoned
    // before the IndexedDB write commits if the user navigates away without
    // finishing the piece - leaving no aggregate row at all, and the library's
    // practice journal (which reads scoreTitle/composer from aggregates)
    // showing "Untitled". Ensure the title/composer land early and cheaply,
    // without touching the stats that endSession() is responsible for.
    ensureAggregateTitle(currentSession)
  }

  function markScoreCompleted() {
    if (!currentSession) return
    currentSession.completedAt = new Date().toISOString()
  }

  // Files a strict run into the session under way: its measures as attempts,
  // the run as a playthrough when it covered the whole score, and the verdict the
  // engine gave it — hit rate, tempo, what went wrong — which is what the
  // history compares strict runs by. Nothing is persisted here: the caller
  // ends the session right after, which writes it once.
  function recordStrictRun({ measures, wholeScore, completed, verdict }) {
    if (!currentSession) return
    if (wholeScore) restartPlaythrough(measures[0].startedAt)
    for (const attempt of measures) recordMeasureAttempt(attempt, { persist: false })
    if (completed) markScoreCompleted()
    currentSession.strict = verdict
  }

  // `at` (an ISO string) dates the restart, for a caller that knows when the
  // run began better than the moment it tells us about it — strict mode files
  // its run once it is over.
  function restartPlaythrough(at = new Date().toISOString()) {
    if (!currentSession) return
    currentSession.playthroughStartedAt = at
  }

  // A hand ticked or unticked before the run has finished its first measure
  // is a false start, not a run played with both selections: the measure under
  // way takes the new hands, and the notes played before the change don't
  // turn a right-hand run into a mixed one. Past that measure, the change is
  // part of the run and the attempts keep the hands they started with.
  function setActiveHands(activeHands) {
    if (!currentMeasureAttempt || !currentSession.playthroughStartedAt) return
    const start = new Date(currentSession.playthroughStartedAt).getTime()
    if (sessionAttempts(currentSession, start).length > 0) return
    currentMeasureAttempt.hands = handsKey(activeHands)
  }

  // A session with no completed measure is not saved.
  function isWorthFiling(session) {
    return session.measures.length > 0
  }

  async function endSession() {
    if (!currentSession) return null

    currentSession.endedAt = new Date().toISOString()

    const sessionToSave = { ...currentSession }

    if (isWorthFiling(sessionToSave)) {
      await storage.saveSession(sessionToSave)
      await updateAggregates(sessionToSave)
    }
    // Committed: whatever a pagehide stashed for *this* session is redundant.
    clearPendingSession(sessionToSave.id)
    // The session just left the "live" slot for the stored history, so the
    // cached copy of that history has to be read again.
    dropSessionCache()

    currentSession = null
    currentMeasureAttempt = null
    return sessionToSave
  }

  // Cheap, idempotent title/composer upsert — see the call site in
  // recordMeasureAttempt() for why this can't just be an early call to
  // updateAggregates(), which accumulates stats and must run exactly once.
  // Skips the IndexedDB round-trip once a session has already ensured it.
  async function ensureAggregateTitle(session) {
    if (aggregateTitleEnsured || (!session.scoreTitle && !session.composer)) return
    // Claimed before the first await: filing a whole run calls this once per
    // measure in a single tick, and a flag set at the end would let every one
    // of those calls through the guard.
    aggregateTitleEnsured = true

    const aggregate = (await storage.getAggregate(session.scoreId)) || createDefaultAggregate(session.scoreId)
    if (aggregate.scoreTitle && aggregate.composer) return

    applyName(aggregate, titleOf(session))
    await storage.saveAggregate(aggregate)
  }

  // `meta` ({ title, composer }) names the score, the session's own name by
  // default. `{}` says there is no name to give, and the aggregate keeps the
  // one it has.
  async function updateAggregates(session, meta = titleOf(session)) {
    const aggregate = foldSession(await storage.getAggregate(session.scoreId), session, meta)
    await storage.saveAggregate(aggregate)
    return aggregate
  }

  async function getScoreStats(scoreId) {
    return storage.getAggregate(scoreId)
  }

  // Measures worth reinforcing right now. Reads the score's recent history —
  // the session under way included — so the suggestion is there as soon as a
  // measure has been fumbled, without waiting for the piece to be played from
  // end to end: on a long score, the first half gets worked on long before the
  // rest has even been sight-read.
  async function getMeasuresToReinforce(scoreId, hands = TWO_HANDS) {
    if (!scoreId) return []
    return measuresToReinforce(await scoreSessions(scoreId), { hands })
  }

  // The score's sessions, with the in-memory one substituted for the copy
  // endMeasureAttempt saved: that one is a measure behind by construction.
  // Windowing and order are the callers' business, not this one's.
  //
  // Sessions are re-read from storage only when the score changes, a session
  // is closed or sessions arrive from elsewhere (rebuildAggregates), because
  // the reinforcement suggestions ask at every measure boundary and
  // getSessions() deserializes the score's whole history.
  async function scoreSessions(scoreId) {
    if (sessionCache.scoreId !== scoreId) {
      sessionCache = { scoreId, sessions: await storage.getSessions(scoreId) }
    }

    const live = currentSession?.scoreId === scoreId ? currentSession : null
    const sessions = sessionCache.sessions.filter((s) => s.id !== live?.id)
    if (live) sessions.push(live)
    return sessions
  }

  function dropSessionCache() {
    sessionCache = { scoreId: null, sessions: [] }
  }

  // The calendar's squares, from one read of the whole history.
  //
  // getDailyLogs() already groups sessions by day, but it answers a much richer
  // question — which scores, which measures, how many full playthroughs, with
  // an aggregate lookup per score — and its cost grows with the number of days
  // asked for. A year of coloured squares needs one duration per day, so this
  // walks the sessions once and keeps only what a square and its tooltip show.
  async function getPracticeCalendar() {
    return buildPracticeCalendar(await storage.getSessions())
  }

  async function getDailyLog(date) {
    return (await getDailyLogs([date]))[0]
  }

  // The journal asks for a run of consecutive days at once: one read of the
  // sessions for all of them, sorted into their days here, and one of the
  // names of their scores.
  async function getDailyLogs(dates) {
    if (dates.length === 0) return []

    const wanted = new Set(dates.map(localDayKey))
    // Day keys sort as text: the read spans the first day's midnight to the
    // one after the last day.
    const days = [...wanted].sort()
    const [sessions, catalog] = await Promise.all([
      storage.getSessionsStartedBetween(startOfLocalDay(days[0]), startOfLocalDay(shiftDayKey(days.at(-1), 1))),
      loadCatalog().catch(() => null),
    ])
    const byDay = new Map()
    const scoreIds = new Set()
    for (const session of sessions) {
      const key = sessionDay(session)
      if (!wanted.has(key)) continue
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key).push(session)
      scoreIds.add(session.scoreId)
    }

    // A score the catalog lists goes by the catalog's name, as the library
    // shows it: the one its sessions were stored under is the file's own,
    // which disagrees with the catalog's on a quarter of it. The row's name is
    // for the others — and for all of them when the catalog cannot be read.
    const names = new Map((await storage.getAggregates([...scoreIds])).map((row) => [row.scoreId, titleOf(row)]))
    for (const scoreId of scoreIds) {
      const listed = catalog?.byUrl.get(scoreId)
      if (listed) names.set(scoreId, listed.name)
    }
    return dates.map((date) => buildDailyLog(byDay.get(localDayKey(date)) ?? [], names))
  }

  async function getScoreHistory(scoreId) {
    return buildScoreHistory(await storage.getSessions(scoreId))
  }
}
