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

// Pick the pending event of matching pitch that is closest in time to `now`,
// within `offTempoWindow` ms. Returns { event, delta } where delta = now - event.timeMs.
// Assumes events are sorted by timeMs ascending so we can stop scanning once
// the next pending event is too far in the future.
export function findMatchingEvent(events, midiNumber, now, offTempoWindow) {
  let best = null
  let bestAbsDelta = Infinity
  for (const event of events) {
    if (event.status !== EVENT_STATUS.PENDING) continue
    if (event.timeMs - now > offTempoWindow) break
    if (event.midiNumber !== midiNumber) continue
    const delta = now - event.timeMs
    const abs = Math.abs(delta)
    if (abs > offTempoWindow) continue
    if (abs < bestAbsDelta) {
      best = event
      bestAbsDelta = abs
    }
  }
  return best ? { event: best, delta: now - best.timeMs } : null
}

// Whether `midiNumber` is one the player may strike at `now` without it being a
// wrong note: a note of an ornament's realization, or a grace note. Each entry
// is { midiNumber, fromMs, untilMs } — the span its pitch is tolerated over —
// and the list is sorted by fromMs, so the scan stops at the first entry that
// has not opened yet.
export function isToleratedNote(tolerated, midiNumber, now) {
  for (const note of tolerated) {
    if (note.fromMs > now) break
    if (note.midiNumber === midiNumber && now <= note.untilMs) return true
  }
  return false
}

export function classifyMatch(delta, tolerance) {
  if (Math.abs(delta) <= tolerance) return CLASSIFICATION.HIT
  return delta < 0 ? CLASSIFICATION.OFFTEMPO_EARLY : CLASSIFICATION.OFFTEMPO_LATE
}
