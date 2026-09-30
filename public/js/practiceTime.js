// How long a session was played for, and the run through the whole score it
// may hold: timed off the measure attempts it recorded, with the interruptions
// taken out — a phone call, a break, a score left open on the desk. The
// journal, the calendar, a score's history and its aggregate row all count by
// these. Pure: sessions in, times and runs out; the tracker records the
// sessions (practiceTracker.js).
import { TWO_HANDS, playthroughHands } from './hands.js'
import { byStartedAt } from './days.js'

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
// unless AGGREGATES_VERSION (aggregates.js) is bumped with them.
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

// Measure attempts overlapping [start, end], in chronological order, flattened
// to what their readers need: when it started, how long it took, which hands
// played it, which measure it was and how many wrong notes it took. Bounds are
// inclusive — a measure played faster than the clock ticks would otherwise fall
// out of the very run it belongs to, and an attempt touching a bound with no
// overlap adds nothing to the time either way. Defaults to every attempt in the
// session.
export function sessionAttempts(session, start = -Infinity, end = Infinity) {
  const attempts = []
  for (const measure of session.measures || []) {
    for (const attempt of measure.attempts || []) {
      if (!attempt.startedAt) continue
      const s = new Date(attempt.startedAt).getTime()
      const durationMs = attempt.durationMs || 0
      if (s + durationMs >= start && s <= end) {
        attempts.push({
          start: s,
          durationMs,
          hands: attempt.hands,
          sourceMeasureIndex: measure.sourceMeasureIndex,
          wrongNotes: attempt.wrongNotes || 0,
        })
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

// The run a completed session holds: when the player started it and finished
// it, and the attempts in between. A session carries at most one: the score
// page ends it and opens the next one as soon as the piece is finished.
function playthroughRun(session) {
  const start = new Date(session.playthroughStartedAt).getTime()
  const end = new Date(session.completedAt).getTime()
  return { start, end, attempts: sessionAttempts(session, start, end) }
}

// That run as a score's history lists it: timed from start to finish, minus
// interruptions — raw wall-clock when no attempt carries usable timing.
export function playthroughOf(session) {
  const { start, end, attempts } = playthroughRun(session)
  return {
    startedAt: session.playthroughStartedAt,
    durationMs: attempts.length === 0 ? end - start : normalizedPlayingTime(attempts, start, end),
    hands: playthroughHands(attempts),
    ...playthroughWrongNotes(attempts),
    // The strict engine's verdict on the run, for a run played to the
    // metronome; a free run has none.
    strict: session.strict ?? null,
  }
}

// The wrong notes a run took, and the measures they fell in (source indices,
// in score order, each once however many times it was played).
function playthroughWrongNotes(attempts) {
  let wrongNotes = 0
  const measures = new Set()
  for (const a of attempts) {
    if (!a.wrongNotes) continue
    wrongNotes += a.wrongNotes
    measures.add(a.sourceMeasureIndex)
  }
  return { wrongNotes, wrongMeasures: [...measures].sort((a, b) => a - b) }
}

// The hands the run held by a completed session was played with.
function completedSessionHands(session) {
  if (!session.playthroughStartedAt) return TWO_HANDS
  return playthroughHands(playthroughRun(session).attempts)
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

// When the player last played in this session, falling back to its start when
// no attempt carries usable timing.
export function getLastMeasureEndTime(session) {
  const attempts = sessionAttempts(session)
  return attempts.length > 0 ? new Date(lastAttemptEnd(attempts)) : new Date(session.startedAt)
}

// The runs through the whole score among `sessions`, most recent first.
export function getFullPlaythroughs(sessions) {
  return sessions
    .filter((session) => session.completedAt && session.playthroughStartedAt)
    .map(playthroughOf)
    .sort((a, b) => byStartedAt(b, a))
}
