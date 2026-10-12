// A score's aggregate row: what its sessions add up to — sessions, practice
// time, practice days, runs played in full, each bar's clean passes — and the
// status the library shows for it. Pure: a row and a session in, the row out;
// the tracker reads and writes the rows (practiceTracker.js).
import { TWO_HANDS, attemptHands } from './hands.js'
import { sessionDay } from './days.js'
import { computeSessionDuration, getLastMeasureEndTime, playedInFull } from './practiceTime.js'

// The rules an aggregate row was counted by, stamped on the row. An aggregate
// is derived once, when a session ends, and then kept — so changing what it
// counts leaves every row already written telling the old story. Bump this
// with such a change, and the tracker's init() replays the sessions of any row
// that carries another number, on every device.
//   2 — a bar's clean passes count both hands only
//   3 — a practice day is the player's own day, not the UTC date (days.js)
export const AGGREGATES_VERSION = 3

// What a score has to clear to earn each status, read by computeScoreStatus()
// below and by the library, which spells the same numbers out to the player
// under a filtered list. Written down once so the two can't drift apart.
// `measureRatio` is the share of the score's measures that must each have been
// played clean `cleanAttempts` times with both hands (see cleanMeasureRatio);
// `practiceDays` and `timesCompleted` are counted over the score's whole
// history, playthroughs in full only.
export const STATUS_THRESHOLDS = {
  perfectionnement: { cleanAttempts: 3, measureRatio: 0.5, timesCompleted: 1 },
  repertoire: { cleanAttempts: 10, measureRatio: 1, practiceDays: 3, timesCompleted: 10 },
}

// The floor under the lowest status. An aggregate row is born the moment a
// single measure is attempted, so a piece opened, tried for a few seconds and
// left behind used to wear a "Déchiffrage" badge for work that never happened.
// One minute of playing time is a read-through of a short piece, and it is the
// very number the library prints beside the badge, so the rule reads itself off
// the row.
export const MIN_PRACTICE_MS_FOR_STATUS = 60_000

export function hasMinimumPractice(aggregate) {
  return (aggregate?.totalPracticeTimeMs || 0) >= MIN_PRACTICE_MS_FOR_STATUS
}

// The share of a score's measures played clean at least `times` times, the
// statuses' yardstick. Read off the aggregates' `cleanAttempts`, which counts
// two-hand passes only: a bar played clean with the right hand and then with
// the left is work on the bar, not the bar played — and counting it let a
// prelude worked hands apart reach Perfectionnement off a single run with both
// (feedback e8e4c2c5).
export function cleanMeasureRatio(aggregate, times) {
  const measures = Object.values(aggregate?.measures || {})
  if (measures.length === 0) return 0
  return measures.filter((m) => m.cleanAttempts >= times).length / measures.length
}

// The name a session or an aggregate row carries for its score, in the shape
// foldSession() takes it.
export function titleOf(record) {
  return { title: record.scoreTitle, composer: record.composer }
}

// scoreId → name, from the rows that carry one: an untitled row would hide a
// name found elsewhere.
export function knownNames(records) {
  return new Map(records.filter((record) => record.scoreTitle).map((record) => [record.scoreId, titleOf(record)]))
}

// Writes onto an aggregate row whichever of the two names is known.
export function applyName(aggregate, { title, composer }) {
  if (title) aggregate.scoreTitle = title
  if (composer) aggregate.composer = composer
}

// Shared skeleton for a brand-new aggregate row (used both by the tracker's
// title upsert and by foldSession(), which layers session-derived fields on
// top).
export function createDefaultAggregate(scoreId) {
  return {
    scoreId,
    // No badge until the practice floor is cleared. This row is written the
    // moment a title is upserted, before a note has been played, so anything
    // else here would award the bottom rung for opening a score.
    status: null,
    scoreTitle: null,
    composer: null,
    rulesVersion: AGGREGATES_VERSION,
    totalSessions: 0,
    totalPracticeTimeMs: 0,
    timesCompleted: 0,
    timesCompletedOneHand: 0,
    practiceDays: [],
    measures: {},
  }
}

// Credits one ended session to its score's aggregate row — `aggregate` left
// out for a score that has none yet — and returns the row. No storage here,
// so a rebuild can fold a whole history in memory.
export function foldSession(aggregate, session, meta) {
  aggregate ??= createDefaultAggregate(session.scoreId)
  applyName(aggregate, meta)

  aggregate.lastPlayedAt = getLastMeasureEndTime(session).toISOString()
  aggregate.totalSessions++

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

  const day = sessionDay(session)
  if (!aggregate.practiceDays.includes(day)) {
    aggregate.practiceDays.push(day)
  }

  const sessionDuration = computeSessionDuration(session)
  aggregate.totalPracticeTimeMs += sessionDuration

  for (const measureData of session.measures) {
    const measureIndex = measureData.sourceMeasureIndex
    if (!aggregate.measures[measureIndex]) {
      aggregate.measures[measureIndex] = { totalAttempts: 0, cleanAttempts: 0, cleanAttemptsOneHand: 0 }
    }

    const measureAgg = aggregate.measures[measureIndex]
    for (const attempt of measureData.attempts) {
      measureAgg.totalAttempts++
      // Like timesCompleted: the plain counter is the one the statuses
      // read, and means both hands.
      if (attempt.clean && attemptHands(attempt) === TWO_HANDS) measureAgg.cleanAttempts++
      else if (attempt.clean) measureAgg.cleanAttemptsOneHand++
    }

    measureAgg.errorRate =
      measureAgg.totalAttempts > 0
        ? (measureAgg.totalAttempts - measureAgg.cleanAttempts - measureAgg.cleanAttemptsOneHand) /
          measureAgg.totalAttempts
        : 0
  }

  aggregate.status = computeScoreStatus(aggregate)
  return aggregate
}

function computeScoreStatus(aggregate) {
  const meets = ({ cleanAttempts, measureRatio, practiceDays = 0, timesCompleted }) =>
    (aggregate.timesCompleted || 0) >= timesCompleted &&
    (aggregate.practiceDays || []).length >= practiceDays &&
    cleanMeasureRatio(aggregate, cleanAttempts) >= measureRatio

  if (meets(STATUS_THRESHOLDS.repertoire)) return 'repertoire'
  if (meets(STATUS_THRESHOLDS.perfectionnement)) return 'perfectionnement'

  // The bottom rung is the only one the floor can bite: the two above it ask
  // for whole playthroughs, which cannot be had in under a minute anyway.
  return hasMinimumPractice(aggregate) ? 'dechiffrage' : null
}
