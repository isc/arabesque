// Pure matching logic for strict-tempo playthrough — no DOM, no audio, no
// timers. Kept separate from strictPlaythrough.js so it can be unit-tested
// without dragging in the playback chain (and its esm.sh @tonejs/piano import).

export const EVENT_STATUS = {
  PENDING: 'pending',
  HIT: 'hit',
  OFFTEMPO: 'offtempo',
  MISSED: 'missed',
}

export const CLASSIFICATION = {
  HIT: 'hit',
  OFFTEMPO_EARLY: 'offtempoEarly',
  OFFTEMPO_LATE: 'offtempoLate',
}

// One thing the run asks the player for, due at `timeMs`: `sequence`, the
// pitches it wants in order, and `openUntilMs`, the instant past which it wants
// nothing more.
//
// A written note asks for a single pitch. An ornament asks for the realization
// the notation determines — the pitches and their order both. A mordent is
// principal, lower neighbour, principal, the neighbour fixed by the key
// signature and by any accidental printed on the sign; a turn written above the
// note is on the beat, one written after it is delayed. Nothing there is left
// to the player. What notation does leave free is how many times a trill
// alternates, and that alone: `alternating` lets one go on between its two
// pitches past the written sequence, until `openUntilMs`. (Free play has its
// own, looser rule for the same sign — see the trill sentinel in musicxml.js.)
//
// The clock judges the opening strike, and only it: that is what makes the
// event a hit or off-tempo, and what anchors an ornament to its beat. The rest
// of the sequence is judged by order — an ornament is played as fast as the
// fingers go, and a per-note window would say nothing true about it — until
// `openUntilMs`, the end of the note being decorated.
export function expectedEvent(fields) {
  return {
    alternating: false,
    // How far into `sequence` the player has got, and the verdict its opening
    // strike earned, which is the one the whole sequence settles on.
    cursor: 0,
    classification: null,
    status: EVENT_STATUS.PENDING,
    ...fields,
  }
}

// Where the cursor lands after a strike. A closed sequence — a mordent, a turn,
// a plain note — walks off its end and takes nothing more; a trill turns back
// to its upper neighbour and goes on alternating.
function nextCursor({ cursor, sequence, alternating }) {
  const next = cursor + 1
  if (next < sequence.length || !alternating) return next
  return sequence.length - 2
}

// The pitch `event` would take at `now`, or null when it can take none.
function awaitedPitch(event, now, offTempoWindow) {
  if (now > event.openUntilMs) return null
  // Whatever an ornament is allowed afterwards, it has to open on its beat like
  // any other note, or it is not being played on the beat at all.
  if (event.cursor === 0 && now - event.timeMs > offTempoWindow) return null
  // Anything with a verdict is done, save a trill that has been credited: it
  // goes on alternating to the end of the note it decorates.
  const open = event.status === EVENT_STATUS.PENDING
    || (event.alternating && event.status !== EVENT_STATUS.MISSED)
  return open ? event.sequence[event.cursor] : null
}

// Pick the event awaiting `midiNumber` that is closest in time to `now`, out of
// those still open. Returns { event, delta } where delta = now - event.timeMs.
// Assumes events are sorted by timeMs ascending so we can stop scanning once
// the next event is too far in the future.
export function findMatchingEvent(events, midiNumber, now, offTempoWindow) {
  let best = null
  let bestAbsDelta = Infinity
  for (const event of events) {
    if (event.timeMs - now > offTempoWindow) break
    if (awaitedPitch(event, now, offTempoWindow) !== midiNumber) continue
    const abs = Math.abs(now - event.timeMs)
    if (abs < bestAbsDelta) {
      best = event
      bestAbsDelta = abs
    }
  }
  return best ? { event: best, delta: now - best.timeMs } : null
}

// Take the strike that matched `event` and answer what the run has to record:
// the classification the event settles on, or null while there is more of it to
// play — an ornament part-way through its realization, or a credited trill
// still alternating. The verdict is the one the first strike earned, whenever
// the last of the sequence arrives.
export function advanceEvent(event, delta, tolerance) {
  if (event.status !== EVENT_STATUS.PENDING) {
    // A credited trill going on alternating: neither counted again nor wrong.
    event.cursor = nextCursor(event)
    return null
  }
  if (event.cursor === 0) event.classification = classifyMatch(delta, tolerance)
  const settles = event.cursor + 1 === event.sequence.length
  event.cursor = nextCursor(event)
  if (!settles) return null
  event.status = event.classification === CLASSIFICATION.HIT
    ? EVENT_STATUS.HIT
    : EVENT_STATUS.OFFTEMPO
  return event.classification
}

// Whether the run lets `midiNumber` through at `now` as a grace note. A grace
// note is struck ahead of the beat and how far ahead is the player's, so it is
// neither asked for nor wrong: its pitch is let through around the beat it
// leans on, over the same window a written note is matched within. Each entry
// is { midiNumber, timeMs }, sorted by timeMs, so the scan stops at the first
// beat that has not come round yet.
export function isGraceStrike(graceNotes, midiNumber, now, offTempoWindow) {
  for (const note of graceNotes) {
    if (note.timeMs - now > offTempoWindow) break
    if (note.midiNumber === midiNumber && now - note.timeMs <= offTempoWindow) return true
  }
  return false
}

export function classifyMatch(delta, tolerance) {
  if (Math.abs(delta) <= tolerance) return CLASSIFICATION.HIT
  return delta < 0 ? CLASSIFICATION.OFFTEMPO_EARLY : CLASSIFICATION.OFFTEMPO_LATE
}
