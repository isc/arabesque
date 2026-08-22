import { isTestEnv } from './utils.js'
import { tsToSeconds, buildMeasureStartTimes, buildCursorTimeline, cursorStepsBeforeMeasure } from './playbackTiming.js'
import { scrollSystemIntoView } from './utils.js'

let piano = null
let midiState = null
let scheduledTimeouts = []
let activeNotes = new Set()
let isPlaying = false
let onPlaybackEnd = null
let activeOsmd = null
let activeAllNotes = null

const GRACE_NOTE_DURATION_S = 0.08
// Must match GRACE_NOTE_OFFSET in noteExtraction.js adjustGraceNoteTimestamps
const GRACE_NOTE_OFFSET_WN = 0.0001

export function initPlayback(externalMidiState = null) {
  midiState = externalMidiState
  return {
    togglePlayback,
    seekToMeasure,
    stop,
    setOnPlaybackEnd: (fn) => { onPlaybackEnd = fn },
    get isPlaying() { return isPlaying },
  }
}

function sendMidi(midiBytes, pianoFn) {
  if (midiState?.midiOutput) {
    midiState.midiOutput.send(midiBytes)
  } else if (piano) {
    pianoFn(piano)
  }
}

function noteOn(midiNumber, velocity) {
  activeNotes.add(midiNumber)
  sendMidi([0x90, midiNumber, Math.round(velocity * 127)], (p) => p.keyDown({ midi: midiNumber, velocity }))
}

function noteOff(midiNumber) {
  activeNotes.delete(midiNumber)
  sendMidi([0x80, midiNumber, 0], (p) => p.keyUp({ midi: midiNumber }))
}

function pedalDown() {
  sendMidi([0xB0, 64, 127], (p) => p.pedalDown())
}

function pedalUp() {
  sendMidi([0xB0, 64, 0], (p) => p.pedalUp())
}

async function ensurePianoLoaded() {
  if (midiState?.midiOutput || piano) return
  // Under test, play silently. The samples are a ~6s CDN download, and it sits
  // between the click on ▶ Écouter and the button becoming ⏹ Stop — so a test
  // asserting that transition was really asserting that a CDN answered within
  // Capybara's 10s, which it does until the machine is busy. Everything the
  // tests do check — scheduling, the cursor, isPlaying — runs without it, and
  // sendMidi() already no-ops when there is neither an output nor a piano.
  if (isTestEnv()) return
  // Imported here, not at the top of the module: @tonejs/piano pulls in Tone
  // (~400KB with its dependencies) and the score page's whole module graph hangs
  // off this file, so a static import made every score wait on a bundle that is
  // only needed once someone presses ▶ Écouter — and only when no MIDI output is
  // connected to play through instead.
  const { Piano } = await import('@tonejs/piano')
  piano = new Piano({ velocities: 1 })
  piano.toDestination()
  await piano.load()
}

export function getBPM(osmdInstance) {
  const sm = osmdInstance.Sheet?.SourceMeasures?.[0]
  const tempo = sm?.TempoExpressions?.[0]?.InstantaneousTempo
  if (!tempo) return sm?.TempoInBPM || 120
  const beatUnitToQuarter = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }
  const ratio = beatUnitToQuarter[tempo.beatUnit] ?? 1
  if (tempo.dotted) return tempo.tempoInBpm * ratio * 1.5
  return tempo.tempoInBpm * ratio
}

// Fixed ornament note duration (in whole-note fractions) for mordents.
// Mordents have a conventional speed independent of the parent note's value.
// Trills and turns are different: they span the full duration of the note.
const ORNAMENT_NOTE_DURATION_WN = 1 / 16

// Recalculate timings for ornaments and grace notes for audio playback.
//
// Ornaments: the note extractor uses ORNAMENT_NOTE_OFFSET=0.00001 between notes (for keyboard
// matching order), which collapses them to the same instant for audio.
// - Mordents: fixed duration per note (tempo-relative, not parent-note-relative)
// - Turns/trills: evenly spread over the full parent note duration. A delayed turn
//   instead holds the principal on the beat for _turnDelay (set by expandOrnamentNotes
//   in noteExtraction.js) and plays the turn proper over the note's final stretch, so
//   audio and the keyboard matcher realize the delayed turn the same way.
// - isTrillEnd sentinels: skipped (only used by the keyboard matching engine)
//
// Grace notes: the extractor places them GRACE_NOTE_OFFSET_WN before their main note
// (≈0.2ms at 120 BPM — effectively simultaneous). Here we schedule them so the last
// grace note ends exactly at the main note's start time.
export function expandOrnamentTimings(notes) {
  const ornamentGroups = new Map()
  const result = []
  let graceGroup = []

  function flushGraceGroup() {
    if (graceGroup.length === 0) return
    const n = graceGroup.length
    // mainTs is the timestamp of the note the grace notes precede
    const mainTs = graceGroup[n - 1].timestamp + GRACE_NOTE_OFFSET_WN
    for (let i = 0; i < n; i++) {
      // _graceOffset: how many grace note durations before mainTs this note starts
      // Last note (i=n-1): starts 1 duration before mainTs, ends exactly at mainTs
      result.push({ ...graceGroup[i], _graceMainTs: mainTs, _graceOffset: n - i })
    }
    graceGroup = []
  }

  for (const noteData of notes) {
    if (noteData.isTrillEnd) continue
    if (noteData.isTrillNote || noteData.isTurnNote || noteData.isMordentNote) {
      flushGraceGroup()
      const group = ornamentGroups.get(noteData.note) ?? []
      if (group.length === 0) ornamentGroups.set(noteData.note, group)
      group.push(noteData)
    } else if (noteData.isGrace) {
      graceGroup.push(noteData)
    } else {
      flushGraceGroup()
      result.push(noteData)
    }
  }
  flushGraceGroup()

  for (const [parentNote, groupNotes] of ornamentGroups) {
    const baseTs = groupNotes[0].timestamp
    const isTrill = groupNotes[0].isTrillNote
    const isTurn = groupNotes[0].isTurnNote
    const turnDelay = groupNotes[0]._turnDelay ?? 0

    if (isTurn && turnDelay > 0) {
      // Delayed turn: hold the principal (groupNotes[0]) on the beat for turnDelay,
      // then play the turn proper over the remainder of the note. Mirrors the
      // keyboard-matcher timing set in expandOrnamentNotes (noteExtraction.js).
      const turnNoteDuration = (parentNote.Length.RealValue - turnDelay) / (groupNotes.length - 1)
      result.push({ ...groupNotes[0], timestamp: baseTs, _ornamentDuration: turnDelay })
      for (let j = 1; j < groupNotes.length; j++) {
        result.push({ ...groupNotes[j], timestamp: baseTs + turnDelay + (j - 1) * turnNoteDuration, _ornamentDuration: turnNoteDuration })
      }
      continue
    }

    const noteDuration = (isTrill || isTurn)
      ? parentNote.Length.RealValue / groupNotes.length
      : ORNAMENT_NOTE_DURATION_WN
    for (let i = 0; i < groupNotes.length; i++) {
      result.push({ ...groupNotes[i], timestamp: baseTs + i * noteDuration, _ornamentDuration: noteDuration })
    }
  }

  result.sort((a, b) => a.timestamp - b.timestamp)
  return result
}

// Fix two OSMD cursor issues that can't be solved with CSS alone:
// - PicoCSS `img { height: auto }` collapses the 1px-tall cursor image
// - OSMD's adjustToBackgroundColor() resets z-index to -1 via inline style
// Schedule cursor.next() advances on the given timeline. Returns the timeout
// IDs so the caller can register them with its own teardown list. The cursor
// starts visible at the first position; subsequent ticks advance it.
export function scheduleCursorAdvances(cursor, cursorTimes, { centerOnCursor = false, skipSteps = 0 } = {}) {
  cursor.reset()
  for (let i = 0; i < skipSteps; i++) cursor.next()
  cursor.show()
  syncCursorStyle(cursor)
  const scoreSvg = document.querySelector('#score svg')
  let lastCursorTop = null
  return cursorTimes.map((t, i) => setTimeout(() => {
    if (i > 0) cursor.next()
    syncCursorStyle(cursor)
    const el = cursor.cursorElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    const top = rect.top + window.scrollY
    if (lastCursorTop === null || Math.abs(top - lastCursorTop) > 10) {
      // Free playback anchors the system's visual top (fingerings/slurs above
      // the staff) below the sticky bars — matching the measure cursor — instead
      // of scrolling the bare cursor line flush to the top, which clipped the
      // above-staff markings. Strict mode centres the cursor instead so the
      // player can read ahead.
      if (centerOnCursor) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        scrollSystemIntoView(rect.top, scoreSvg)
      }
    }
    lastCursorTop = top
  }, t))
}

export function syncCursorStyle(cursor) {
  const el = cursor.cursorElement
  if (!el) return
  el.style.height = el.getAttribute('height') + 'px'
  el.style.zIndex = '10'
}

function hideCursor() {
  if (activeOsmd?.cursor) {
    activeOsmd.cursor.hide()
    activeOsmd.cursor.reset()
  }
}

// Cancel all pending events and silence the instrument, without touching the
// playing flag or cursor — shared by stop() (which then tears down) and
// seekToMeasure() (which immediately reschedules from the clicked measure).
function clearSchedule() {
  for (const id of scheduledTimeouts) clearTimeout(id)
  scheduledTimeouts = []
  // Release every note still sounding — their scheduled noteOff timeouts were
  // just cancelled, so without this they would ring indefinitely.
  for (const midiNumber of [...activeNotes]) noteOff(midiNumber)
  pedalUp()
  if (midiState?.midiOutput) {
    midiState.midiOutput.send([0xB0, 123, 0]) // All Notes Off
  }
}

function stop() {
  clearSchedule()
  isPlaying = false
  hideCursor()
}

async function togglePlayback(allNotes, osmdInstance) {
  if (isPlaying) { stop(); return }
  await ensurePianoLoaded()
  startPlayback(allNotes, osmdInstance, 0)
}

// Jump live playback to a clicked measure: cancel the pending schedule and
// reschedule from there. No-op when nothing is playing (a measure click then
// falls through to its non-playback handler). The piano is already loaded, so
// this runs synchronously from the click handler.
function seekToMeasure(measureIndex) {
  if (!isPlaying || !activeAllNotes || !activeOsmd) return
  clearSchedule()
  startPlayback(activeAllNotes, activeOsmd, measureIndex)
}

function startPlayback(allNotes, osmdInstance, startMeasureIndex = 0) {
  activeOsmd = osmdInstance
  activeAllNotes = allNotes
  const bpm = getBPM(osmdInstance)
  const sourceMeasures = osmdInstance.Sheet.SourceMeasures

  const cursorSkipSteps = cursorStepsBeforeMeasure(allNotes, startMeasureIndex, sourceMeasures, bpm)
  const playNotes = allNotes.slice(startMeasureIndex)
  const measureStartTimes = buildMeasureStartTimes(playNotes, sourceMeasures)
  let maxEndMs = 0

  for (let i = 0; i < playNotes.length; i++) {
    const measureData = playNotes[i]
    const measureStartTs = measureStartTimes[i]
    const measureOffset = measureStartTs - measureData.measureIndex
    const notes = expandOrnamentTimings(measureData.notes)

    for (const n of notes) {
      let startMs, durationMs

      if (n._graceMainTs !== undefined) {
        const mainMs = tsToSeconds(measureOffset + n._graceMainTs, bpm) * 1000
        startMs = Math.max(0, mainMs - n._graceOffset * GRACE_NOTE_DURATION_S * 1000)
        durationMs = GRACE_NOTE_DURATION_S * 1000
      } else {
        startMs = tsToSeconds(measureOffset + n.timestamp, bpm) * 1000
        durationMs = tsToSeconds(n._ornamentDuration ?? n.note.Length.RealValue, bpm) * 1000
      }

      if (!n.isTieContinuation) {
        scheduledTimeouts.push(setTimeout(() => noteOn(n.midiNumber, 0.7), startMs))
      }
      scheduledTimeouts.push(setTimeout(() => noteOff(n.midiNumber), startMs + durationMs))

      maxEndMs = Math.max(maxEndMs, startMs + durationMs)
    }

    for (const pe of measureData.pedalEvents || []) {
      const eventMs = tsToSeconds(measureOffset + pe.timestamp, bpm) * 1000
      scheduledTimeouts.push(setTimeout(pe.type === 'pedalDown' ? pedalDown : pedalUp, eventMs))
    }
  }

  if (osmdInstance.cursor) {
    const cursorSteps = buildCursorTimeline(playNotes, measureStartTimes, bpm)
    scheduledTimeouts.push(...scheduleCursorAdvances(osmdInstance.cursor, cursorSteps, { skipSteps: cursorSkipSteps }))
  }

  isPlaying = true
  scheduledTimeouts.push(setTimeout(() => {
    isPlaying = false
    hideCursor()
    onPlaybackEnd?.()
  }, maxEndMs + 500))
}
