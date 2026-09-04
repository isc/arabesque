import { scheduleCursorAdvances } from './playback.js'
import {
  tsToSeconds,
  buildMeasureStartTimes,
  buildCursorTimeline,
  cursorStepsBeforeMeasure,
  measureDurationTs,
} from './playbackTiming.js'
import { handsKey } from './hands.js'
import {
  isOrnamentOrGrace,
  isNoteActiveForHands,
  sourceMeasuresToResetOnEntry,
  svgNoteheadFor,
} from './noteExtraction.js'
import {
  findMatchingEvent,
  classifyMatch,
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
let activeOsmd = null
let pendingEvents = []
let stats = null
let onCompleteCb = null
let onProgressCb = null
let activeHands = { right: true, left: true }
let audioContext = null
let startedAtPerf = 0
// Wall clock at the same instant as startedAtPerf, so the run's measures can be
// dated for the practice journal (see measureAttempts).
let startedAtWall = 0
// One entry per measure of the run, in playback order, holding when it played
// and what went wrong in it (see measureAttempts).
let measureRuns = []
// Where the run was started from, kept for the result: teardown() runs before
// the callback, and a run from the top is what can count as the piece played
// in full.
let runStartMeasureIndex = 0
let currentToleranceMs = DEFAULT_TOLERANCE_MS
let currentOffTempoWindowMs = DEFAULT_OFFTEMPO_WINDOW_MS

export function initStrictPlaythrough() {
  return {
    start,
    stop,
    handleNoteOn,
    setActiveHands: (h) => { activeHands = { ...activeHands, ...h } },
    get isPlaying() { return isRunning },
  }
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioContext.state === 'suspended') audioContext.resume()
}

function click({ accent = false } = {}) {
  if (!audioContext) return
  const t0 = audioContext.currentTime
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.frequency.value = accent ? 1500 : 1000
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05)
  osc.connect(gain).connect(audioContext.destination)
  osc.start(t0)
  osc.stop(t0 + 0.06)
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

function shouldExpectInput(noteData) {
  if (isOrnamentOrGrace(noteData)) return false
  if (noteData.isTieContinuation) return false
  return isNoteActiveForHands(noteData, activeHands)
}

function start({
  bpm,
  allNotes,
  osmdInstance,
  tolerance = DEFAULT_TOLERANCE_MS,
  offTempoWindow = DEFAULT_OFFTEMPO_WINDOW_MS,
  countInBeats,
  startMeasureIndex = 0,
  onComplete,
  onProgress,
}) {
  if (isRunning) return
  if (!osmdInstance || !allNotes?.length) return

  ensureAudio()
  activeOsmd = osmdInstance
  onCompleteCb = onComplete
  onProgressCb = onProgress
  currentToleranceMs = tolerance
  currentOffTempoWindowMs = offTempoWindow
  isRunning = true

  runStartMeasureIndex = startMeasureIndex
  const sourceMeasures = osmdInstance.Sheet.SourceMeasures
  const cursorSkipSteps = cursorStepsBeforeMeasure(allNotes, startMeasureIndex, sourceMeasures, bpm)
  allNotes = allNotes.slice(startMeasureIndex)
  const measureStartTimes = buildMeasureStartTimes(allNotes, sourceMeasures)
  const beatMs = 60_000 / bpm
  const resolvedCountInBeats = countInBeats ?? quarterBeatsInFirstMeasure(sourceMeasures)
  const countInMs = resolvedCountInBeats * beatMs

  pendingEvents = []
  measureRuns = allNotes.map((measureData, i) => ({
    sourceMeasureIndex: measureData.sourceMeasureIndex,
    startMs: countInMs + tsToSeconds(measureStartTimes[i], bpm) * 1000,
    durationMs: tsToSeconds(measureDurationTs(measureData, sourceMeasures), bpm) * 1000,
    wrongNotes: 0,
  }))
  const cursorTimes = buildCursorTimeline(allNotes, measureStartTimes, bpm, countInMs)

  // Single pass: look up each notehead once, clear residual strict-mode
  // classes from prior runs, push expected inputs into pendingEvents.
  for (let i = 0; i < allNotes.length; i++) {
    const measureData = allNotes[i]
    const measureOffset = measureStartTimes[i] - measureData.measureIndex

    for (const noteData of measureData.notes) {
      const noteheadEl = svgNoteheadFor(activeOsmd, noteData)
      noteheadEl?.classList.remove(...STRICT_CLASSES)

      if (!shouldExpectInput(noteData)) continue

      const ts = measureOffset + noteData.timestamp
      const noteTimeMs = countInMs + tsToSeconds(ts, bpm) * 1000

      pendingEvents.push({
        timeMs: noteTimeMs,
        midiNumber: noteData.midiNumber,
        noteData,
        noteheadEl,
        measureIndex: i,
        sourceMeasureIndex: measureData.sourceMeasureIndex,
        status: EVENT_STATUS.PENDING,
      })
    }
  }

  pendingEvents.sort((a, b) => a.timeMs - b.timeMs)
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

  for (let i = 0; i < resolvedCountInBeats; i++) {
    const t = i * beatMs
    timeouts.push(setTimeout(() => click({ accent: i === 0 }), t))
  }

  if (pendingEvents.length > 0) {
    const lastTimeMs = pendingEvents[pendingEvents.length - 1].timeMs
    const beatsDuringMusic = Math.ceil((lastTimeMs - countInMs) / beatMs) + 1
    for (let i = 0; i <= beatsDuringMusic; i++) {
      const t = countInMs + i * beatMs
      timeouts.push(setTimeout(() => click({ accent: false }), t))
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
        if (sources.has(event.sourceMeasureIndex)) {
          event.noteheadEl?.classList.remove(...STRICT_CLASSES)
        }
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

    timeouts.push(setTimeout(() => {
      if (event.status !== EVENT_STATUS.PENDING) return
      event.status = EVENT_STATUS.MISSED
      stats.missed++
      event.noteheadEl?.classList.remove(CLS_EXPECTED)
      event.noteheadEl?.classList.add(CLS_MISSED)
      onProgressCb?.({ ...stats })
    }, event.timeMs + offTempoWindow))
  }

  const lastEventTime = pendingEvents.length > 0
    ? pendingEvents[pendingEvents.length - 1].timeMs
    : countInMs
  // Finish only after every miss timeout has had a chance to fire.
  const tailMs = lastEventTime + offTempoWindow + TAIL_PADDING_MS
  timeouts.push(setTimeout(() => finish(false), tailMs))
}

function handleNoteOn(midiNumber) {
  if (!isRunning) return false
  const now = performance.now() - startedAtPerf
  const match = findMatchingEvent(pendingEvents, midiNumber, now, currentOffTempoWindowMs)
  if (!match) {
    stats.wrongNotes++
    // Charged to the measure being played through. Anything struck during the
    // count-in belongs to no measure and is only counted in the run's stats.
    const run = runAt(now)
    if (run) run.wrongNotes++
    onProgressCb?.({ ...stats })
    return false
  }
  const { event, delta } = match
  const classification = classifyMatch(delta, currentToleranceMs)
  event.noteheadEl?.classList.remove(CLS_EXPECTED)
  if (classification === CLASSIFICATION.HIT) {
    event.status = EVENT_STATUS.HIT
    stats.hit++
    event.noteheadEl?.classList.add(CLS_PLAYED)
  } else {
    // Single offtempo status; early vs late is captured in the stats only.
    event.status = EVENT_STATUS.OFFTEMPO
    if (classification === CLASSIFICATION.OFFTEMPO_EARLY) stats.offTempoEarly++
    else stats.offTempoLate++
    event.noteheadEl?.classList.add(CLS_OFFTEMPO)
  }
  onProgressCb?.({ ...stats })
  return true
}

// The measure being played through at `ms` from the start of the run, or null
// while the count-in is still going.
function runAt(ms) {
  let current = null
  for (const run of measureRuns) {
    if (ms < run.startMs) break
    current = run
  }
  return current
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
  activeOsmd = null
  pendingEvents = []
  measureRuns = []
}

function finish(aborted) {
  if (!isRunning) return
  isRunning = false
  const finalStats = stats
  const measures = measureAttempts()
  // Played from the top with every expected note played: the piece practised
  // in full. Same bar as free mode, where the cursor never gets past a note
  // that wasn't played.
  const fromTheTop = runStartMeasureIndex === 0
  const completed = fromTheTop && !aborted && finalStats.missed === 0
  teardown()
  onCompleteCb?.({ ...finalStats, aborted, measures, fromTheTop, completed })
}

function stop() {
  finish(true)
}
