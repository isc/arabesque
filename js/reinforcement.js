// Which bars of a score need work: the ones reinforcement mode offers on the
// score page, read off the score's most recent sessions, each hand selection
// apart — bars fumbled there and not played cleanly since, a bar played with
// the right notes and a hole in it being fumbled as much as one with a wrong
// note (steadiness.js): the drill does not fill its dot either. Pure: sessions
// in, bars out; the tracker hands over the score's sessions
// (practiceTracker.js).
import { NO_HANDS, attemptHands } from './hands.js'
import { byStartedAt } from './days.js'

// Reinforcement suggestions look at this many of a score's most recent
// sessions. What was fumbled months ago says nothing about what needs work
// today, and the window bounds a computation that runs at every measure.
export const REINFORCEMENT_WINDOW_SESSIONS = 10

// Clean passes that retire a measure from the suggestions, and fill a drill's
// dots in training (musicxml.js). Counted the drill's way in a training
// session — reinforcement is filed as training — where a spoiled repetition
// leaves the dots already filled; in a row anywhere else. A measure the drill
// has just called done leaves the suggestions with it.
export const REINFORCEMENT_CLEAN_PASSES = 3

// Sessions a measure must span before its error rate can be called stagnant.
const STAGNATION_MIN_SESSIONS = 3

// What reinforcement mode offers on the score page. Given a score's sessions
// in any order, the measures it would drill right now, best candidates first.
//
// Each hand selection keeps a list of its own (feedback 0868d96f): a bar
// fumbled with the left hand alone is not a bar to drill two-handed, and clean
// right-hand passes don't retire a bar still fumbled with both. `hands` is the
// selection asked about, as handsKey() stores it; left out, every selection
// answers on its own and each candidate says which one it came from.
export function measuresToReinforce(sessions, { hands, limit = 5 } = {}) {
  return [...reinforceCandidates(sessions, hands)]
    .sort(
      (a, b) =>
        Number(b.stagnant) - Number(a.stagnant) ||
        b.wrongNotes + b.hesitations - (a.wrongNotes + a.hesitations) ||
        b.durationMs - a.durationMs
    )
    .slice(0, limit)
}

// The window that makes the suggestions forget: only the last
// REINFORCEMENT_WINDOW_SESSIONS sessions of a score count, so a bar massacred
// six months ago and left alone says nothing today.
function recentSessions(sessions) {
  return [...sessions].sort(byStartedAt).slice(-REINFORCEMENT_WINDOW_SESSIONS)
}

// The measures worth offering, unranked, over that window.
function* reinforceCandidates(sessions, hands) {
  for (const { sourceMeasureIndex, hands: selection, bySession, modes } of measureHistories(recentSessions(sessions), hands)) {
    const attempts = bySession.flat()
    if (!attempts.some(fumbled)) continue
    // Settled: played cleanly REINFORCEMENT_CLEAN_PASSES times in a row since,
    // or drilled to done in training and not fumbled since.
    if (cleanStreak(attempts) >= REINFORCEMENT_CLEAN_PASSES || drilledToDone(bySession, modes)) continue

    yield {
      sourceMeasureIndex,
      hands: selection,
      attempts: attempts.length,
      fumbles: countFumbles(attempts),
      wrongNotes: attempts.reduce((sum, a) => sum + (a.wrongNotes || 0), 0),
      hesitations: attempts.reduce((sum, a) => sum + (a.hesitations || 0), 0),
      durationMs: attempts[attempts.length - 1].durationMs || 0,
      stagnant: isStagnant(bySession),
    }
  }
}

// Attempts per hand selection and measure across the given sessions — only
// the `hands` selection when one is given — kept grouped by session: the
// totals answer "how badly", the grouping answers "is it getting better".
function measureHistories(sessions, hands) {
  const bySelection = new Map()

  for (const session of sessions) {
    for (const measure of session.measures || []) {
      for (const attempt of measure.attempts || []) {
        const selection = attemptHands(attempt)
        if (selection === NO_HANDS || (hands && selection !== hands)) continue

        let histories = bySelection.get(selection)
        if (!histories) bySelection.set(selection, (histories = new Map()))
        let history = histories.get(measure.sourceMeasureIndex)
        if (!history) {
          history = { sourceMeasureIndex: measure.sourceMeasureIndex, hands: selection, bySession: [], modes: [], session: null }
          histories.set(measure.sourceMeasureIndex, history)
        }
        if (history.session !== session) {
          history.session = session
          history.bySession.push([])
          history.modes.push(session.mode)
        }
        history.bySession.at(-1).push(attempt)
      }
    }
  }

  return [...bySelection.values()].flatMap((histories) => [...histories.values()])
}

// A wrong note always fails the attempt, but the matcher can fail one on its
// own (a missed note ends the measure unclean without recording anything).
// So does a hole, which `clean` leaves out — it keeps meaning no wrong note,
// for the history and the statuses (aggregates.js) — and which attempts from
// before hesitations were counted cannot have.
function fumbled(attempt) {
  return attempt.clean === false || (attempt.wrongNotes || 0) > 0 || (attempt.hesitations || 0) > 0
}

function countFumbles(attempts) {
  return attempts.filter(fumbled).length
}

function cleanStreak(attempts) {
  let streak = 0
  for (let i = attempts.length - 1; i >= 0 && !fumbled(attempts[i]); i--) streak++
  return streak
}

// Whether the measure's last training session — its drill — gave it its
// clean passes, a spoiled one among them or not, with no fumble in any
// session since. `bySession` and `modes` as measureHistories keeps them.
function drilledToDone(bySession, modes) {
  for (let i = bySession.length - 1; i >= 0; i--) {
    const attempts = bySession[i]
    if (modes[i] === 'training' && attempts.length - countFumbles(attempts) >= REINFORCEMENT_CLEAN_PASSES) return true
    if (attempts.some(fumbled)) return false
  }
  return false
}

// Stagnation is the trend over sessions, not within one: a measure stagnates
// when the error rate of its recent sessions is no better than that of the
// earlier ones. Below STAGNATION_MIN_SESSIONS there is no trend to read, only
// the noise of a good day and a bad one.
function isStagnant(bySession) {
  if (bySession.length < STAGNATION_MIN_SESSIONS) return false
  const rates = bySession.map((attempts) => countFumbles(attempts) / attempts.length)
  const split = Math.floor(rates.length / 2)
  return mean(rates.slice(split)) >= mean(rates.slice(0, split))
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
