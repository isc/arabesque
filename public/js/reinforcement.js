// What of a score needs work: the bars, and the joins between them, that
// reinforcement mode offers on the score page, read off the score's most
// recent sessions, each hand selection apart — fumbled there and not played
// cleanly since. A bar is fumbled by a wrong note or a hole inside it, a bar
// played with the right notes and a hole being fumbled as much as one with a
// wrong note (steadiness.js): the drill does not fill its dot either. A join
// is fumbled where the way into a bar from the one before was a hole, or a
// wrong note — the leap down into bar 33 of the C minor prelude, or the hand
// opening late into bar 19 — which drilling the bar on its own never plays:
// each repetition starts on it. So a join is drilled as the two bars together,
// and the bar an attempt is filed under is the one the join leads into. Pure:
// sessions in, candidates out; the tracker hands over the score's sessions
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

// What a kind of candidate reads of an attempt: whether it says anything about
// it at all, whether it was fumbled, and how many faults it holds — what the
// two kinds are ranked together by. Every attempt tells of its bar; only one
// entered from the bar before, in the same run, tells of the join
// (practiceTracker.js), and a drill of the bar alone never does.
// A wrong note on the way into a bar is the join's: the bar's own are the rest.
const wrongInside = (a) => (a.wrongNotes || 0) - (a.entryWrongNotes || 0)

const BAR = {
  join: false,
  measured: () => true,
  // A wrong note fails the attempt, and the matcher can fail one on its own
  // (strict mode's missed notes end a measure unclean with no wrong note
  // recorded). So does a hole, which `clean` leaves out — it keeps meaning no
  // wrong note, for the history and the statuses (aggregates.js) — and which
  // attempts from before hesitations were counted cannot have.
  fumbled: (a) => wrongInside(a) > 0 || (a.hesitations || 0) > 0 || (a.clean === false && !a.wrongNotes),
  faults: (a) => wrongInside(a) + (a.hesitations || 0),
}
// Attempts filed before `joined` say nothing of their join: a hole there was
// counted among their hesitations.
const JOIN = {
  join: true,
  measured: (a) => a.joined === true,
  fumbled: (a) => a.entryHole === true || (a.entryWrongNotes || 0) > 0,
  faults: (a) => (a.entryWrongNotes || 0) + (a.entryHole ? 1 : 0),
}

// What reinforcement mode offers on the score page. Given a score's sessions
// in any order, what it would drill right now, best candidates first: bars,
// and joins — `join: true`, the join into the bar `sourceMeasureIndex` — ranked
// together by how many faults they gathered.
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
        b.faults - a.faults ||
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

// The bars and joins worth offering, unranked, over that window.
function* reinforceCandidates(sessions, hands) {
  for (const history of measureHistories(recentSessions(sessions), hands)) {
    for (const kind of [BAR, JOIN]) {
      const offered = candidate(kind, history)
      if (offered) yield offered
    }
  }
}

// What `kind` makes of a bar's history: null when there is nothing to work —
// never fumbled, or settled since: played cleanly REINFORCEMENT_CLEAN_PASSES
// times in a row, or drilled to done in training and not fumbled since.
function candidate(kind, { sourceMeasureIndex, hands, bySession: allSessions, modes: allModes }) {
  const bySession = []
  const modes = []
  allSessions.forEach((attempts, i) => {
    const measured = attempts.filter(kind.measured)
    if (measured.length === 0) return
    bySession.push(measured)
    modes.push(allModes[i])
  })
  const attempts = bySession.flat()
  if (!attempts.some(kind.fumbled)) return null
  if (cleanStreak(kind, attempts) >= REINFORCEMENT_CLEAN_PASSES || drilledToDone(kind, bySession, modes)) return null
  return {
    sourceMeasureIndex,
    join: kind.join,
    hands,
    attempts: attempts.length,
    faults: attempts.reduce((sum, a) => sum + kind.faults(a), 0),
    durationMs: attempts[attempts.length - 1].durationMs || 0,
    stagnant: isStagnant(kind, bySession),
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

function countFumbles(kind, attempts) {
  return attempts.filter(kind.fumbled).length
}

function cleanStreak(kind, attempts) {
  let streak = 0
  for (let i = attempts.length - 1; i >= 0 && !kind.fumbled(attempts[i]); i--) streak++
  return streak
}

// Whether the last training session — the drill — gave it its clean passes, a
// spoiled one among them or not, with no fumble in any session since.
// `bySession` and `modes` as measureHistories keeps them.
function drilledToDone(kind, bySession, modes) {
  for (let i = bySession.length - 1; i >= 0; i--) {
    const attempts = bySession[i]
    if (modes[i] === 'training' && attempts.length - countFumbles(kind, attempts) >= REINFORCEMENT_CLEAN_PASSES) return true
    if (attempts.some(kind.fumbled)) return false
  }
  return false
}

// Stagnation is the trend over sessions, not within one: a measure stagnates
// when the error rate of its recent sessions is no better than that of the
// earlier ones. Below STAGNATION_MIN_SESSIONS there is no trend to read, only
// the noise of a good day and a bad one.
function isStagnant(kind, bySession) {
  if (bySession.length < STAGNATION_MIN_SESSIONS) return false
  const rates = bySession.map((attempts) => countFumbles(kind, attempts) / attempts.length)
  const split = Math.floor(rates.length / 2)
  return mean(rates.slice(split)) >= mean(rates.slice(0, split))
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
