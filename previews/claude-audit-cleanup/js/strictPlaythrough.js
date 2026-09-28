import { scheduleCursorAdvances } from './playback.js'
import {
  tsToSeconds,
  buildMeasureStartTimes,
  buildCursorTimeline,
  cursorStepsBeforeMeasure,
  measureIndexAt,
} from './playbackTiming.js'
import { handsKey } from './hands.js'
import { prepareClick, playClick } from './metronomeClick.js'
import {
  requiredSequence,
  isNoteActiveForHands,
  sourceMeasuresToResetOnEntry,
  svgNoteheadFor,
} from './noteExtraction.js'
import {
  findMatchingEvent,
  faultAbsorbingEvent,
  expectedEvent,
  advanceEvent,
  isGraceStrike,
  EVENT_STATUS,
  CLASSIFICATION,
} from './strictMatching.js'

const DEFAULT_TOLERANCE_MS = 150
// Notes played beyond the strict tolerance but within this wider window are
// counted as "off-tempo" instead of wrong notes.
const DEFAULT_OFFTEMPO_WINDOW_MS = 450
const FALLBACK_COUNT_IN_BEATS = 4
// Buffer past the last miss timeout before finish() fires, so onComplete
// always sees the final stats rather than a stale snapshot.
const TAIL_PADDING_MS = 300
const CLS_EXPECTED = 'expected-note'
const CLS_PLAYED = 'played-note'
const CLS_OFFTEMPO = 'offtempo-note'
const CLS_MISSED = 'missed-note'
const STRICT_CLASSES = [CLS_EXPECTED, CLS_PLAYED, CLS_OFFTEMPO, CLS_MISSED]

let timeouts = []
let isRunning = false
// The score the module works on. Outlives the run that set it — the marks a run
// leaves are read off it long after teardown(), by clearMarks and repaintMarks —
// and is dropped with them, never before.
let activeOsmd = null
let pendingEvents = []
// Grace pitches with the beat each leans on: let through, never asked for.
let graceNotes = []
let stats = null
let onCompleteCb = null
let onProgressCb = null
let onCountInCb = null
let activeHands = { right: true, left: true }
let startedAtPerf = 0
// Wall clock at the same instant as startedAtPerf, so the run's measures can be
// dated for the practice journal (see measureAttempts).
let startedAtWall = 0
// One entry per measure of the run, in playback order, holding when it played
// and what went wrong in it (see measureAttempts).
let measureRuns = []
// Whether the run covers the score from its first measure to its last, kept
// for the result: teardown() runs before the callback, and only such a run can
// count as the piece played in full — not one started partway, nor a passage
// looped by the tempo trainer.
let runWholeScore = true
// The tempo the run was played at, part of the verdict: a hit rate means
// nothing without it.
let runBpm = 0
let currentToleranceMs = DEFAULT_TOLERANCE_MS
let currentOffTempoWindowMs = DEFAULT_OFFTEMPO_WINDOW_MS
// The last run's verdict: one strict class per note, keyed by the note itself
// rather than by the element it is drawn on. Every redraw replaces that element
// — a phone turned, a window widened, a fingering entered — so a cached node is
// a node the next relayout detaches, marks and all. Kept as data instead, the
// verdict is re-applied by repaintMarks() and taken off by clearMarks(), both
// of which look the notehead up again.
let markedNotes = new Map()

export function initStrictPlaythrough() {
  return {
    start,
    stop,
    clearMarks,
    repaintMarks,
    handleNoteOn,
    setActiveHands,
    get isPlaying() { return isRunning },
  }
}

// A run's marks are a verdict on the hands it asked for (start() filters every
// note through isNoteActiveForHands) as much as on the passage it covered, so
// changing a hand takes the last one's marks off: a hand dropped, the notes it
// missed would stay red over notes the next run will not ask for.
//
// Not mid-run — it would wipe the verdict the run is still collecting, leaving
// the notes already judged bare and the ones after them marked. The hand
// checkboxes are disabled for the length of a run (score.html) so this should
// not arise; the guard is here because only this module can see why it matters.
function setActiveHands(hands) {
  if (!isRunning) clearMarks()
  activeHands = { ...activeHands, ...hands }
}

// One full measure of count-in, expressed in quarter-note beats so it lines up
// with the engine's quarter-note metronome. OSMD's measure Duration.RealValue
// is a fraction of a whole note, so ×4 converts to quarter notes
// (4/4 → 4, 3/4 → 3, 6/8 → 3, 2/2 → 4). Pickup measures are skipped so the
// count-in lasts a full bar, not just the anacrusis.
function quarterBeatsInFirstMeasure(sourceMeasures) {
  if (!sourceMeasures?.length) return FALLBACK_COUNT_IN_BEATS
  const fullBar = sourceMeasures.find((m) => !m.ImplicitMeasure) ?? sourceMeasures[0]
  const dur = fullBar?.Duration?.RealValue
  if (!dur) return FALLBACK_COUNT_IN_BEATS
  // Floor at 1 so a degenerate sub-quarter first measure (e.g. 1/16)
  // doesn't round to a zero-beat count-in.
  return Math.max(1, Math.round(dur * 4))
}

// Returns [{ atMs, sources }] for each repeat-boundary crossing in allNotes,
// dated off the same measureRuns entries the practice journal is dated from.
// Caller schedules the actual class-clear timeouts. Ordering matters at the
// scheduling site: when a chord lands on the first beat of a repeated
// measure, the reset must be enqueued before the chord's window-open so FIFO
// on equal-time setTimeouts fires the reset first — otherwise the new
// expected-note class lands and is immediately wiped.
function planRepeatResets(allNotes, runs) {
  const playedSources = new Set([allNotes[0].sourceMeasureIndex])
  const plans = []
  for (let i = 0; i < allNotes.length - 1; i++) {
    const sources = sourceMeasuresToResetOnEntry(allNotes, i, i + 1, playedSources)
    if (sources.size > 0) {
      plans.push({ atMs: runs[i + 1].startMs, sources })
    }
    playedSources.add(allNotes[i + 1].sourceMeasureIndex)
  }
  return plans
}

// What one note of the score asks the run for (requiredSequence says it, in
// whole-note fractions; this puts it on the run's clock), or null when it asks
// for nothing — the notes an ornament is spelled out in, and a pitch a tie
// already holds.
function eventForNote(noteData, { timeMs, bpm, offTempoWindow, ...rest }) {
  const { sequence, delayTs, holdTs, alternating } = requiredSequence(noteData)
  if (sequence.length === 0) return null
  return expectedEvent({
    timeMs: timeMs + tsToSeconds(delayTs, bpm) * 1000,
    sequence,
    openUntilMs: timeMs + tsToSeconds(holdTs, bpm) * 1000 + offTempoWindow,
    alternating,
    noteData,
    ...rest,
  })
}

function start({
  bpm,
  allNotes,
  osmdInstance,
  tolerance = DEFAULT_TOLERANCE_MS,
  offTempoWindow = DEFAULT_OFFTEMPO_WINDOW_MS,
  countInBeats,
  startMeasureIndex = 0,
  // Inclusive; the run goes to the end of the score by default.
  endMeasureIndex = null,
  onComplete,
  onProgress,
  onCountIn,
}) {
  if (isRunning || !osmdInstance || !allNotes?.length) {
    // Nothing to run: over before it began, and said so the way any aborted
    // run is, so that nothing waits on it.
    onComplete?.({ verdict: null, aborted: true, measures: [], wholeScore: false, completed: false })
    return
  }

  prepareClick()
  // Off with the last run's verdict, against the score it was earned on, before
  // this run adopts its own.
  clearMarks()
  activeOsmd = osmdInstance
  onCompleteCb = onComplete
  onProgressCb = onProgress
  onCountInCb = onCountIn
  currentToleranceMs = tolerance
  currentOffTempoWindowMs = offTempoWindow
  isRunning = true

  const lastMeasureIndex = Math.min(endMeasureIndex ?? Infinity, allNotes.length - 1)
  runWholeScore = startMeasureIndex === 0 && lastMeasureIndex === allNotes.length - 1
  runBpm = bpm
  const cursorSkipSteps = cursorStepsBeforeMeasure(allNotes, startMeasureIndex)
  allNotes = allNotes.slice(startMeasureIndex, lastMeasureIndex + 1)
  const measureStartTimes = buildMeasureStartTimes(allNotes)
  const beatMs = 60_000 / bpm
  const resolvedCountInBeats = countInBeats ?? quarterBeatsInFirstMeasure(osmdInstance.Sheet.SourceMeasures)
  const countInMs = resolvedCountInBeats * beatMs

  pendingEvents = []
  graceNotes = []
  measureRuns = allNotes.map((measureData, i) => ({
    sourceMeasureIndex: measureData.sourceMeasureIndex,
    startMs: countInMs + tsToSeconds(measureStartTimes[i], bpm) * 1000,
    durationMs: tsToSeconds(measureData.duration, bpm) * 1000,
    wrongNotes: 0,
  }))
  const cursorTimes = buildCursorTimeline(allNotes, measureStartTimes, bpm, countInMs)

  // Each note sorted into what the run asks for (pendingEvents) or merely lets
  // through (graceNotes), the former carrying the notehead it lights up — looked
  // up here, once, rather than at every strike.
  for (let i = 0; i < allNotes.length; i++) {
    const measureData = allNotes[i]
    const measureOffset = measureStartTimes[i] - measureData.measureIndex

    for (const noteData of measureData.notes) {
      if (!isNoteActiveForHands(noteData, activeHands)) continue

      const ts = measureOffset + noteData.timestamp
      const noteTimeMs = countInMs + tsToSeconds(ts, bpm) * 1000

      // Not asked for, and not wrong either: see isGraceStrike.
      if (noteData.isGrace) {
        const { startMs, durationMs } = measureRuns[i]
        const untilMs = noteData.isAfterGrace ? startMs + durationMs : noteTimeMs
        graceNotes.push({ midiNumber: noteData.midiNumber, timeMs: noteTimeMs, untilMs })
        continue
      }

      const event = eventForNote(noteData, {
        timeMs: noteTimeMs,
        bpm,
        offTempoWindow,
        noteheadEl: svgNoteheadFor(activeOsmd, noteData),
        measureIndex: i,
        sourceMeasureIndex: measureData.sourceMeasureIndex,
      })
      if (event) pendingEvents.push(event)
    }
  }

  pendingEvents.sort((a, b) => a.timeMs - b.timeMs)
  graceNotes.sort((a, b) => a.timeMs - b.timeMs)
  stats = {
    total: pendingEvents.length,
    hit: 0,
    offTempoEarly: 0,
    offTempoLate: 0,
    missed: 0,
    wrongNotes: 0,
  }

  startedAtPerf = performance.now()
  startedAtWall = Date.now()

  // Each count-in beat is reported as it lands, for a view that shows the count
  // to a player who cannot hear it. Beat 0 means the count is over.
  for (let i = 0; i < resolvedCountInBeats; i++) {
    const t = i * beatMs
    timeouts.push(setTimeout(() => {
      playClick({ accent: i === 0 })
      onCountInCb?.({ beat: i + 1, beats: resolvedCountInBeats })
    }, t))
  }
  timeouts.push(setTimeout(() => onCountInCb?.({ beat: 0, beats: resolvedCountInBeats }), countInMs))

  if (pendingEvents.length > 0) {
    const lastTimeMs = pendingEvents[pendingEvents.length - 1].timeMs
    const beatsDuringMusic = Math.ceil((lastTimeMs - countInMs) / beatMs) + 1
    for (let i = 0; i <= beatsDuringMusic; i++) {
      const t = countInMs + i * beatMs
      timeouts.push(setTimeout(() => playClick(), t))
    }
  }

  if (osmdInstance.cursor) {
    timeouts.push(...scheduleCursorAdvances(osmdInstance.cursor, cursorTimes, { centerOnCursor: true, skipSteps: cursorSkipSteps }))
  }

  // Schedule repeat-reset class wipes BEFORE the per-event window-open loop:
  // when both fire at the same instant (chord on the first beat of a
  // repeated measure), FIFO order on equal-time setTimeouts ensures the wipe
  // runs first and the new expected-note class survives.
  for (const { atMs, sources } of planRepeatResets(allNotes, measureRuns)) {
    timeouts.push(setTimeout(() => {
      for (const event of pendingEvents) {
        if (sources.has(event.sourceMeasureIndex)) unmarkNote(event)
      }
    }, atMs))
  }

  // Visual cue lights up at T (in sync with cursor). Match remains possible
  // until T + offTempoWindow — within tolerance is "in tempo", beyond is
  // "off tempo late". Past that, the event is genuinely missed.
  for (const event of pendingEvents) {
    timeouts.push(setTimeout(() => {
      if (event.status !== EVENT_STATUS.PENDING) return
      event.noteheadEl?.classList.add(CLS_EXPECTED)
    }, event.timeMs))

    // Nothing struck by the time the window closes: the note is missed, and so
    // is an ornament never begun.
    timeouts.push(setTimeout(() => {
      if (event.status === EVENT_STATUS.PENDING && event.cursor === 0) missEvent(event)
    }, event.timeMs + offTempoWindow))

    // An ornament begun and left unfinished by the end of the note it
    // decorates: the realization the score writes was not played.
    if (event.openUntilMs > event.timeMs + offTempoWindow) {
      timeouts.push(setTimeout(() => {
        if (event.status === EVENT_STATUS.PENDING) missEvent(event)
      }, event.openUntilMs))
    }
  }

  // Finish only after every miss timeout has had a chance to fire — the last of
  // them belongs to whichever event stays open longest, not to the last one due.
  const lastCloseMs = pendingEvents.reduce(
    (latest, event) => Math.max(latest, event.openUntilMs),
    countInMs + offTempoWindow,
  )
  timeouts.push(setTimeout(() => finish(false), lastCloseMs + TAIL_PADDING_MS))
}

// The verdict a note ends on: painted on the score in place of the highlight
// that was asking for it, and recorded so a redraw can paint it again. The
// highlight itself is not recorded — it says where the music is, not how it
// went, and no redraw should bring it back.
function markNote(event, cls) {
  event.noteheadEl?.classList.remove(CLS_EXPECTED)
  event.noteheadEl?.classList.add(cls)
  markedNotes.set(event.noteData, cls)
}

// A verdict taken back — the class off the score and out of the model, or the
// next redraw would put it straight back on.
function unmarkNote(event) {
  event.noteheadEl?.classList.remove(...STRICT_CLASSES)
  markedNotes.delete(event.noteData)
}

function missEvent(event) {
  event.status = EVENT_STATUS.MISSED
  stats.missed++
  markNote(event, CLS_MISSED)
  onProgressCb?.({ ...stats })
}

function handleNoteOn(midiNumber) {
  if (!isRunning) return false
  const now = performance.now() - startedAtPerf
  const match = findMatchingEvent(pendingEvents, midiNumber, now, currentOffTempoWindowMs)
  if (!match) {
    // A grace note leaning on the beat: not a hit, not a fault.
    if (isGraceStrike(graceNotes, midiNumber, now, currentOffTempoWindowMs)) return true
    // More of an ornament that has already answered for itself.
    const ornament = faultAbsorbingEvent(pendingEvents, midiNumber, now)
    if (ornament?.faulted) return false
    if (ornament) ornament.faulted = true
    stats.wrongNotes++
    // Charged to the measure being played through. Anything struck during the
    // count-in belongs to no measure and is only counted in the run's stats.
    const run = runAt(now)
    if (run) run.wrongNotes++
    onProgressCb?.({ ...stats })
    return false
  }
  const { event, delta } = match
  const classification = advanceEvent(event, delta, currentToleranceMs)
  // More of the ornament to come, or a trill still alternating past the
  // realization it was credited for: the note is taken, nothing is settled yet.
  if (!classification) return true
  if (classification === CLASSIFICATION.HIT) {
    stats.hit++
    markNote(event, CLS_PLAYED)
  } else {
    // Single offtempo status; early vs late is captured in the stats only.
    if (classification === CLASSIFICATION.OFFTEMPO_EARLY) stats.offTempoEarly++
    else stats.offTempoLate++
    markNote(event, CLS_OFFTEMPO)
  }
  onProgressCb?.({ ...stats })
  return true
}

// The measure being played through at `ms` from the start of the run, or null
// while the count-in is still going.
function runAt(ms) {
  const i = measureIndexAt(measureRuns, ms, (run) => run.startMs)
  return i < 0 ? null : measureRuns[i]
}

// The run, measure by measure, in the shape the practice tracker files an
// attempt in — the piece practised in strict mode is practice like any other,
// and this is what puts it in the journal.
//
// A measure only counts once every note it expected has a verdict: the run is
// driven by the metronome, so a measure is over well before its last off-tempo
// window closes, and a run stopped mid-piece leaves that tail undecided. Timing
// comes from the tempo rather than from a clock read at each boundary — that is
// exactly what the player played to.
function measureAttempts() {
  const expected = new Map()
  for (const event of pendingEvents) {
    const counts = expected.get(event.measureIndex) ?? { missed: 0, pending: 0 }
    if (event.status === EVENT_STATUS.MISSED) counts.missed++
    if (event.status === EVENT_STATUS.PENDING) counts.pending++
    expected.set(event.measureIndex, counts)
  }

  const hands = handsKey(activeHands)
  const attempts = []
  for (const [index, counts] of expected) {
    if (counts.pending > 0) continue
    const run = measureRuns[index]
    attempts.push({
      sourceMeasureIndex: run.sourceMeasureIndex,
      startedAt: new Date(startedAtWall + run.startMs).toISOString(),
      durationMs: Math.round(run.durationMs),
      wrongNotes: run.wrongNotes,
      clean: counts.missed === 0 && run.wrongNotes === 0,
      hands,
    })
  }
  // pendingEvents is sorted by time, so the attempts come out in playing order.
  return attempts
}

function teardown() {
  for (const id of timeouts) clearTimeout(id)
  timeouts = []
  if (activeOsmd?.cursor) {
    activeOsmd.cursor.hide()
    activeOsmd.cursor.reset()
  }
  // Played/offtempo/missed marks stay visible after the run so the player can
  // see the breakdown; the next start() wipes them. Only clear the in-flight
  // expected-note highlight that no terminal status would have removed.
  for (const event of pendingEvents) {
    if (event.status === EVENT_STATUS.PENDING) {
      event.noteheadEl?.classList.remove(CLS_EXPECTED)
    }
  }
  pendingEvents = []
  graceNotes = []
  measureRuns = []
}

// Wipes the last run's marks off the score — what teardown() leaves for the
// player to read, and what has no business staying once another mode is on.
function clearMarks() {
  for (const noteData of markedNotes.keys()) {
    svgNoteheadFor(activeOsmd, noteData)?.classList.remove(...STRICT_CLASSES)
  }
  markedNotes.clear()
  activeOsmd = null
}

// Puts the last run's verdict back on a score that has just been redrawn.
// Called from the page's repaint, beside the other marks a redraw costs.
function repaintMarks() {
  for (const [noteData, cls] of markedNotes) {
    svgNoteheadFor(activeOsmd, noteData)?.classList.add(cls)
  }
}

function finish(aborted) {
  if (!isRunning) return
  isRunning = false
  const finalStats = stats
  const measures = measureAttempts()
  // The whole score, from the top to the end: the piece practised in full,
  // whatever the verdict says of it — the metronome moves on past a missed
  // note, so demanding none would leave almost no run of a real piece in the
  // journal, and the verdict is what a strict run is read by.
  const wholeScore = runWholeScore
  const completed = wholeScore && !aborted
  teardown()
  // The verdict — what the run is judged by — travels as one value, so what
  // stores it need not know its fields.
  onCompleteCb?.({ verdict: { ...finalStats, bpm: runBpm }, aborted, measures, wholeScore, completed })
}

function stop() {
  finish(true)
}
