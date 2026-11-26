import { scheduleCursorAdvances } from './playback.js?v=627d5aa13b33'
import {
  tsToSeconds,
  buildMeasureStartTimes,
  buildCursorTimeline,
  cursorStepsBeforeMeasure,
  measureIndexAt,
} from './playbackTiming.js?v=627d5aa13b33'
import { handsKey } from './hands.js?v=627d5aa13b33'
import { prepareClick, playClick, clickTrack } from './metronomeClick.js?v=627d5aa13b33'
import {
  requiredSequence,
  isNoteActiveForHands,
  sourceMeasuresToResetOnEntry,
  svgNoteheadFor,
  handOfNote,
} from './noteExtraction.js?v=627d5aa13b33'
import {
  findMatchingEvent,
  nearestOwedEvent,
  chargesStrayStrike,
  expectedEvent,
  advanceEvent,
  isGraceStrike,
  EVENT_STATUS,
  CLASSIFICATION,
} from './strictMatching.js?v=627d5aa13b33'

const DEFAULT_TOLERANCE_MS = 150
// Notes played beyond the strict tolerance but within this wider window are
// counted as "off-tempo" instead of wrong notes.
const DEFAULT_OFFTEMPO_WINDOW_MS = 450
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
// From when on, on the run's clock, a strike nothing takes is no wrong note.
// The run listens past the passage's last bar line for its last notes'
// off-tempo windows, and a player going on into the next bar is not playing
// wrong notes (feedback 9337d522: the downbeat after a loop cost a clean run
// its ✅). So from a tolerance short of the bar line — a downbeat comes in a
// little early as often as late — but never within the tolerance of the
// passage's last note, which a key brushed with it would otherwise get away with.
let straysFreeFromMs = Infinity
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
// The run before's verdict, as [noteData, notehead] pairs, while it stays up
// through this run's count-in: what went wrong is what the player reads before
// going again, and wiping it as ▶ was pressed — or as a loop started its next
// run — left a second of red to read it in. It goes a window short of the first
// beat, the earliest this run's first strike can land; the noteheads are
// looked up at ▶, so that moment only takes the classes off.
let fadingMarks = []
let onAttemptStartedCb = null
// What went wrong in the run, fault by fault, for the verdict the band says of
// it (attemptVerdict.js).
let faults = []
// The keys down, for the notes a tie holds: one is heard to its end only while
// the key that struck it stays down (checkHold).
let keysDown = new Set()

export function initStrictPlaythrough() {
  return {
    start,
    stop,
    clearMarks,
    repaintMarks,
    handleNoteOn,
    handleNoteOff,
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
  startMeasureIndex = 0,
  // Inclusive; the run goes to the end of the score by default.
  endMeasureIndex = null,
  onComplete,
  onProgress,
  onCountIn,
  // The music is about to come in: the run before is behind the player.
  onAttemptStarted,
  // Whether the run asks for a note: all of them, but for a drill of a
  // fragment (ladder.js), which asks for those inside it as training does —
  // and starts `from` where it does in its first bar, in whole notes.
  owes = () => true,
  from = 0,
}) {
  if (isRunning || !osmdInstance || !allNotes?.length) {
    // Nothing to run: over before it began, and said so the way any aborted
    // run is, so that nothing waits on it.
    onComplete?.({ verdict: null, aborted: true, measures: [], wholeScore: false, completed: false })
    return
  }

  prepareClick()
  // The last run's verdict stays up, against the score it was earned on, until
  // this run is about to come in (fadingMarks).
  wipeFadingMarks()
  fadingMarks = [...markedNotes.keys()].map((noteData) => [noteData, svgNoteheadFor(activeOsmd, noteData)])
  markedNotes = new Map()
  faults = []
  keysDown = new Set()
  activeOsmd = osmdInstance
  onCompleteCb = onComplete
  onProgressCb = onProgress
  onCountInCb = onCountIn
  onAttemptStartedCb = onAttemptStarted
  currentToleranceMs = tolerance
  currentOffTempoWindowMs = offTempoWindow
  isRunning = true

  const lastMeasureIndex = Math.min(endMeasureIndex ?? Infinity, allNotes.length - 1)
  runWholeScore = startMeasureIndex === 0 && lastMeasureIndex === allNotes.length - 1
  runBpm = bpm
  const cursorSkipSteps = cursorStepsBeforeMeasure(allNotes, startMeasureIndex)
  allNotes = allNotes.slice(startMeasureIndex, lastMeasureIndex + 1)
  const measureStartTimes = buildMeasureStartTimes(allNotes)
  // Counted in on the time signature of the run's first bar, and on into that
  // bar when it is a pickup, or straight into a run from partway into it
  // (clickTrack). The run's first bar then starts before the count-in is over,
  // by as much of it as the run leaves out.
  const { countInMs, countInBeats, clicks } = clickTrack(allNotes, bpm, from)
  const musicMs = countInMs - tsToSeconds(from, bpm) * 1000

  pendingEvents = []
  graceNotes = []
  measureRuns = allNotes.map((measureData, i) => ({
    sourceMeasureIndex: measureData.sourceMeasureIndex,
    startMs: musicMs + tsToSeconds(measureStartTimes[i], bpm) * 1000,
    durationMs: tsToSeconds(measureData.duration, bpm) * 1000,
    wrongNotes: 0,
    // Some of its notes not asked for: its attempt says nothing of the bar
    // as a whole (practiceTracker's `partial`).
    partial: false,
  }))
  const cursorTimes = buildCursorTimeline(allNotes, measureStartTimes, bpm, musicMs)

  // Each note sorted into what the run asks for (pendingEvents) or merely lets
  // through (graceNotes), the former carrying the notehead it lights up — looked
  // up here, once, rather than at every strike. When the notes not asked for
  // are due, for the end of the run below. And the notes a tie holds, each
  // with the event that struck its tie: asked for nothing, but checked as they
  // come round (checkHold) — they never turned green, held or not (feedback
  // 7cd0121a).
  const unowed = []
  const struckTies = new Map()
  const holds = []
  for (let i = 0; i < allNotes.length; i++) {
    const measureData = allNotes[i]
    const measureOffset = measureStartTimes[i] - measureData.measureIndex

    for (const noteData of measureData.notes) {
      if (!isNoteActiveForHands(noteData, activeHands)) continue

      const ts = measureOffset + noteData.timestamp
      const noteTimeMs = musicMs + tsToSeconds(ts, bpm) * 1000
      if (!owes(noteData)) {
        measureRuns[i].partial = true
        unowed.push(noteTimeMs)
        continue
      }

      // Not asked for, and not wrong either: see isGraceStrike.
      if (noteData.isGrace) {
        const { startMs, durationMs } = measureRuns[i]
        const untilMs = noteData.isAfterGrace ? startMs + durationMs : noteTimeMs
        graceNotes.push({ midiNumber: noteData.midiNumber, timeMs: noteTimeMs, untilMs })
        continue
      }

      const noteheadEl = svgNoteheadFor(activeOsmd, noteData)
      const event = eventForNote(noteData, {
        timeMs: noteTimeMs,
        bpm,
        offTempoWindow,
        noteheadEl,
        measureIndex: i,
        sourceMeasureIndex: measureData.sourceMeasureIndex,
      })
      const tie = noteData.note?.NoteTie
      if (event) {
        pendingEvents.push(event)
        if (tie && !noteData.isTieContinuation) struckTies.set(tie, event)
      } else if (noteData.isTieContinuation) {
        holds.push({
          noteData,
          noteheadEl,
          timeMs: noteTimeMs,
          sourceMeasureIndex: measureData.sourceMeasureIndex,
          struck: struckTies.get(tie),
        })
      }
    }
  }

  pendingEvents.sort((a, b) => a.timeMs - b.timeMs)
  graceNotes.sort((a, b) => a.timeMs - b.timeMs)
  const lastRun = measureRuns[measureRuns.length - 1]
  const lastDueMs = pendingEvents[pendingEvents.length - 1]?.timeMs ?? 0
  // A fragment ending inside its bar is gone on from where the rest of the
  // bar comes in, as a passage is from its last bar line.
  const goingOnMs = Math.min(lastRun.startMs + lastRun.durationMs, ...unowed.filter((ms) => ms > lastDueMs))
  straysFreeFromMs = Math.max(goingOnMs - tolerance, lastDueMs + tolerance)
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

  // The click, from the first beat of the count-in through the run's last bar,
  // or until finish() cuts it short. Each count-in beat is also reported as it
  // lands, for a view that shows the count to a player who cannot hear it. Beat
  // 0 means the count is over.
  for (const { atMs, beat, kind, countIn } of clicks) {
    timeouts.push(setTimeout(() => {
      playClick(kind)
      if (countIn && kind !== 'subdivision') onCountInCb?.({ beat: beat + 1, beats: countInBeats })
    }, atMs))
  }
  timeouts.push(setTimeout(() => onCountInCb?.({ beat: 0, beats: countInBeats }), countInMs))
  timeouts.push(setTimeout(() => {
    wipeFadingMarks()
    onAttemptStartedCb?.()
  }, Math.max(0, countInMs - offTempoWindow)))

  // On the run's first note: one from partway into its bar has the cursor
  // wait there rather than walk the beats before it through the count-in.
  if (osmdInstance.cursor) {
    const before = Math.max(0, cursorTimes.findIndex((ms) => ms >= countInMs - 1))
    timeouts.push(...scheduleCursorAdvances(osmdInstance.cursor, cursorTimes.slice(before), {
      skipSteps: cursorSkipSteps + before,
      keepInView: endMeasureIndex != null,
    }))
  }

  // Schedule repeat-reset class wipes BEFORE the per-event window-open loop:
  // when both fire at the same instant (chord on the first beat of a
  // repeated measure), FIFO order on equal-time setTimeouts ensures the wipe
  // runs first and the new expected-note class survives.
  for (const { atMs, sources } of planRepeatResets(allNotes, measureRuns)) {
    timeouts.push(setTimeout(() => {
      for (const event of [...pendingEvents, ...holds]) {
        if (sources.has(event.sourceMeasureIndex)) unmarkNote(event)
      }
    }, atMs))
  }

  for (const hold of holds) timeouts.push(setTimeout(() => checkHold(hold), hold.timeMs))

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

// A fault of the run, at the note `event` asked for.
function addFault(kind, event) {
  faults.push({ kind, bar: event.sourceMeasureIndex, hand: handOfNote(event.noteData) })
}

// A wrong key, put against the note it was meant for: that note turns red,
// as free play's do (musicxml.js, FUMBLED). Counted and nothing more, a run
// with two wrong notes ended all green, the score not saying where they were.
// A note still owed waits to be played to turn red — the green it would get
// would say it went clean.
function fumble(event) {
  addFault('wrong', event)
  event.fumbled = true
  if (event.status !== EVENT_STATUS.PENDING) markNote(event, CLS_MISSED)
}

// A note a tie holds, come round: heard only while the key that struck the tie
// is still down — green then, and off the click's colour, a fault, where it was
// let go before. Nothing is said of one whose tie went unstruck: that note is
// already missed.
function checkHold(hold) {
  if (hold.struck?.status !== EVENT_STATUS.SETTLED) return
  if (keysDown.has(hold.noteData.midiNumber)) {
    markNote(hold, CLS_PLAYED)
    return
  }
  addFault('released', hold)
  markNote(hold, CLS_OFFTEMPO)
}

function missEvent(event) {
  event.status = EVENT_STATUS.MISSED
  stats.missed++
  addFault('missed', event)
  markNote(event, CLS_MISSED)
  onProgressCb?.({ ...stats })
}

function handleNoteOn(midiNumber) {
  if (!isRunning) return false
  keysDown.add(midiNumber)
  const now = performance.now() - startedAtPerf
  const match = findMatchingEvent(pendingEvents, midiNumber, now, currentOffTempoWindowMs)
  if (!match) {
    // A grace note leaning on the beat: not a hit, not a fault.
    if (isGraceStrike(graceNotes, midiNumber, now, currentOffTempoWindowMs)) return true
    if (now >= straysFreeFromMs || !chargesStrayStrike(pendingEvents, midiNumber, now)) return false
    stats.wrongNotes++
    // Charged to the measure being played through. Anything struck during the
    // count-in belongs to no measure and is only counted in the run's stats.
    const run = runAt(now)
    if (run) run.wrongNotes++
    // Put against the note it was most likely meant for; with none due, a key
    // in a rest or the count-in, against its bar if it has one.
    const owed = nearestOwedEvent(pendingEvents, midiNumber, now, currentOffTempoWindowMs)
    if (owed) fumble(owed)
    else faults.push({ kind: 'wrong', bar: run?.sourceMeasureIndex ?? null })
    onProgressCb?.({ ...stats })
    return false
  }
  const { event, delta } = match
  const classification = advanceEvent(event, delta, currentToleranceMs)
  // More of the ornament to come, or a trill still alternating past the
  // realization it was credited for: the note is taken, nothing is settled yet.
  if (!classification) return true
  const hit = classification === CLASSIFICATION.HIT
  if (hit) stats.hit++
  else {
    // Single offtempo status; early vs late is captured in the stats only.
    const early = classification === CLASSIFICATION.OFFTEMPO_EARLY
    if (early) stats.offTempoEarly++
    else stats.offTempoLate++
    addFault(early ? 'early' : 'late', event)
  }
  markNote(event, event.fumbled ? CLS_MISSED : hit ? CLS_PLAYED : CLS_OFFTEMPO)
  onProgressCb?.({ ...stats })
  return true
}

function handleNoteOff(midiNumber) {
  keysDown.delete(midiNumber)
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
      ...(run.partial && { partial: true }),
    })
  }
  // pendingEvents is sorted by time, so the attempts come out in playing order.
  return attempts
}

function teardown() {
  for (const id of timeouts) clearTimeout(id)
  timeouts = []
  // A run stopped in its count-in: the verdict before it goes with it.
  wipeFadingMarks()
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
  wipeFadingMarks()
  for (const noteData of markedNotes.keys()) {
    svgNoteheadFor(activeOsmd, noteData)?.classList.remove(...STRICT_CLASSES)
  }
  markedNotes.clear()
  activeOsmd = null
}

// The run before's verdict off the score — but for a note this run has already
// given a verdict of its own.
function wipeFadingMarks() {
  for (const [noteData, notehead] of fadingMarks) {
    if (!markedNotes.has(noteData)) notehead?.classList.remove(...STRICT_CLASSES)
  }
  fadingMarks = []
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
  onCompleteCb?.({ verdict: { ...finalStats, bpm: runBpm }, aborted, measures, wholeScore, completed, faults })
}

function stop() {
  finish(true)
}
