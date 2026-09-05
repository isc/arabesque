import { isTestEnv } from './utils.js'
import { appSoundEnabled } from './appSound.js'
import { tsToSeconds, buildMeasureStartTimes, buildCursorTimeline, cursorStepsBeforeMeasure } from './playbackTiming.js'
import { scrollSystemIntoView } from './utils.js'

// The three states the transport can be in. Paused is not stopped: the piece is
// still on the stand at the bar it was held at.
const STOPPED = 'stopped'
const PLAYING = 'playing'
const PAUSED = 'paused'

let piano = null
// The sampler's load while it is still in flight, so every caller waits on the
// one download (see ensurePianoLoaded).
let pianoLoading = null
let midiState = null
let scheduledTimeouts = []
let activeNotes = new Set()
// One field rather than a playing flag beside a paused one: "playing and paused
// at once" is then not something a mutation can leave behind.
let transport = STOPPED
let onPlaybackEnd = null
let activeOsmd = null
let activeAllNotes = null
// Where the running schedule started and where each of its measures falls from
// that instant — enough for ⏸, ▶ and a tempo change to say which bar is
// sounding, without a timer per bar to keep a counter up to date.
let scheduleStartedAt = 0
let scheduleFirstMeasure = 0
let scheduleMeasureOffsetsMs = []
// The bar the piece is held at, and where ▶ picks it up. Only meaningful while
// paused; stop() puts it back to the top.
let heldAtMeasure = 0
// The tempo to play at, in BPM. Null until the page sets one, so a score
// listened to before anything is chosen goes at the tempo it is written at.
let playbackBpm = null

const GRACE_NOTE_DURATION_S = 0.08

// How hard playback presses each key. The engine has no dynamics of its own, so
// this one value *is* the playback level, and it has to sit under the touch of
// someone practising — it was a forte, so ▶ Écouter came out of the player's own
// piano much louder than their own playing.
//
// Deliberately a velocity and not a volume (CC 7) or expression (CC 11)
// message: a CC turns the instrument itself down, and would have to be restored
// on every way playback can end — ⏹, a seek, the last note, a closed tab, a
// pulled cable — any one of them missed leaving the piano quiet under the
// player's own hands. A velocity only describes the note it is sent with, so
// there is nothing to put back.
const PLAYBACK_VELOCITY = 0.5
const PLAYBACK_VELOCITY_BYTE = Math.round(PLAYBACK_VELOCITY * 127) // 64

// Must match GRACE_NOTE_OFFSET in noteExtraction.js adjustGraceNoteTimestamps
const GRACE_NOTE_OFFSET_WN = 0.0001

export function initPlayback(externalMidiState = null) {
  midiState = externalMidiState
  return {
    play,
    pause,
    seekToMeasure,
    setTempo,
    stop,
    setOnPlaybackEnd: (fn) => { onPlaybackEnd = fn },
    get transport() { return transport },
    get currentMeasureIndex() { return currentMeasure() },
  }
}

// Where the score's own sound goes: the instrument by default, the app's
// sampler when the player asked for it or when there is nothing to send to.
function playbackGoesToInstrument() {
  return !!midiState?.midiOutput && !appSoundEnabled()
}

function sendMidi(midiBytes, pianoFn) {
  if (playbackGoesToInstrument()) {
    midiState.midiOutput.send(midiBytes)
  } else if (piano) {
    pianoFn(piano)
  }
}

function noteOn(midiNumber) {
  activeNotes.add(midiNumber)
  sendMidi(
    [0x90, midiNumber, PLAYBACK_VELOCITY_BYTE],
    (p) => p.keyDown({ midi: midiNumber, velocity: PLAYBACK_VELOCITY }),
  )
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

function ensurePianoLoaded() {
  if (piano) return pianoLoading
  if (playbackGoesToInstrument()) return
  // Under test, play silently. The samples are a ~6s CDN download, and it sits
  // between the click on ▶ Écouter and the button becoming ⏹ Stop — so a test
  // asserting that transition was really asserting that a CDN answered within
  // Capybara's 10s, which it does until the machine is busy. Everything the
  // tests do check — scheduling, the cursor, the transport — runs without it, and
  // sendMidi() already no-ops when there is neither an output nor a piano.
  if (isTestEnv()) return
  // The load is remembered, not just its result: `piano` is only assigned once
  // the samples are in, so a second call while they are coming would build a
  // whole second sampler — and echoNoteOn calls this on every note the player
  // presses, which during the download is one sampler and one full sample set
  // per key.
  //
  // Imported here, not at the top of the module: @tonejs/piano pulls in Tone
  // (~400KB with its dependencies) and the score page's whole module graph hangs
  // off this file, so a static import made every score wait on a bundle that is
  // only needed once someone presses ▶ Écouter — and only when no MIDI output is
  // connected to play through instead.
  pianoLoading ??= (async () => {
    const { Piano } = await import('@tonejs/piano')
    const loaded = new Piano({ velocities: 1 })
    loaded.toDestination()
    await loaded.load()
    piano = loaded
  })()
  return pianoLoading
}

// Pulls the samples in before the first note when the app is making the sound,
// so the player does not lose the start of their playing to a download.
//
// Gated on the setting alone, never on whether an instrument is connected: a
// page calls this while connectMIDI is still in flight, so midiOutput is null
// at that moment whatever is plugged in — testing it would load the samples for
// everyone and undo the lazy import below.
export function warmUp() {
  if (!appSoundEnabled()) return
  // Nobody awaits this: a CDN that never answers leaves the player without the
  // app's sound, which the console should say and the page should survive.
  ensurePianoLoaded()?.catch((e) => console.error('Sampler failed to load:', e))
}

// The keys and pedal the player works, sounded by the app rather than by the
// instrument. See appSound.js for what that costs the player in exchange.
//
// Awaiting the load on the first note would swallow it and the several after
// it, so a note that arrives while the samples are still coming is dropped
// rather than queued — a late note is worse than a missing one under the hands.
export function echoNoteOn(midiNumber, velocityByte) {
  if (!appSoundEnabled()) return
  ensurePianoLoaded()
  piano?.keyDown({ midi: midiNumber, velocity: velocityByte / 127 })
}

// Releases are not gated on the setting: turning it off with keys down would
// otherwise leave them ringing with nothing left to lift them, and releasing a
// key the sampler never pressed costs nothing.
export function echoNoteOff(midiNumber) {
  piano?.keyUp({ midi: midiNumber })
}

export function echoPedal(down) {
  if (!appSoundEnabled() && down) return
  if (down) piano?.pedalDown()
  else piano?.pedalUp()
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

function syncCursorStyle(cursor) {
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
  if (playbackGoesToInstrument()) {
    midiState.midiOutput.send([0xB0, 123, 0]) // All Notes Off
  }
}

// Which bar is sounding, worked out from the clock rather than tracked: the
// schedule already knows where every bar line falls, so the answer is a walk
// over those offsets instead of a timer per bar kept alive to update a counter.
// Held or stopped, the answer is the bar ▶ would start from.
function currentMeasure() {
  if (transport !== PLAYING) return heldAtMeasure
  const elapsed = performance.now() - scheduleStartedAt
  let i = 0
  while (i + 1 < scheduleMeasureOffsetsMs.length && scheduleMeasureOffsetsMs[i + 1] <= elapsed) i++
  return scheduleFirstMeasure + i
}

function stop() {
  clearSchedule()
  transport = STOPPED
  heldAtMeasure = 0
  hideCursor()
}

// Holds the piece where it is: everything pending is cancelled, but the measure
// it had reached and the cursor stay, so play() resumes from that bar. Resuming
// from the bar line rather than from the exact instant is deliberate — it is
// where a pianist picks a piece back up, and it is the one point the schedule
// can be rebuilt from without re-deriving every note's remaining duration.
function pause() {
  if (transport !== PLAYING) return
  heldAtMeasure = currentMeasure()
  clearSchedule()
  transport = PAUSED
  showCursorAtMeasure(heldAtMeasure)
}

// Starts the piece, or picks it up where ⏸ left it. Stopping is stop()'s job:
// this is only ever the ▶ side, so a second ▶ while it plays changes nothing.
async function play(allNotes, osmdInstance) {
  if (transport === PLAYING) return
  await ensurePianoLoaded()
  startPlayback(allNotes, osmdInstance, heldAtMeasure)
}

// Where the piece is played from: live, a clicked measure is jumped to at once
// (cancel the pending schedule, reschedule from there); paused, it becomes the
// bar ▶ will resume at, and the cursor moves there to say so. No-op when
// nothing is going on, so a measure click then falls through to its
// non-playback handler. The piano is already loaded, so this runs synchronously
// from the click handler.
function seekToMeasure(measureIndex) {
  if (!activeAllNotes || !activeOsmd) return
  if (transport === PAUSED) {
    heldAtMeasure = measureIndex
    showCursorAtMeasure(measureIndex)
    return
  }
  if (transport !== PLAYING) return
  clearSchedule()
  startPlayback(activeAllNotes, activeOsmd, measureIndex)
}

// The tempo the piece is heard at, kept across pieces so it is chosen once.
// Changing it mid-piece takes effect from the bar being played, so the player
// hears the new tempo without being sent back to the top.
function setTempo(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm === playbackBpm) return
  const resumeAt = currentMeasure()
  playbackBpm = bpm
  if (transport === PLAYING) seekToMeasure(resumeAt)
}

function bpmFor(osmdInstance) {
  return playbackBpm ?? getBPM(osmdInstance)
}

// Puts the cursor on a measure's first stop without scheduling anything —
// scheduleCursorAdvances with an empty timeline is exactly that.
function showCursorAtMeasure(measureIndex) {
  const cursor = activeOsmd?.cursor
  if (!cursor) return
  const skipSteps = cursorStepsBeforeMeasure(activeAllNotes, measureIndex, activeOsmd.Sheet.SourceMeasures, bpmFor(activeOsmd))
  scheduleCursorAdvances(cursor, [], { skipSteps })
}

function startPlayback(allNotes, osmdInstance, startMeasureIndex = 0) {
  activeOsmd = osmdInstance
  activeAllNotes = allNotes
  const bpm = bpmFor(osmdInstance)
  const sourceMeasures = osmdInstance.Sheet.SourceMeasures

  const cursorSkipSteps = cursorStepsBeforeMeasure(allNotes, startMeasureIndex, sourceMeasures, bpm)
  const playNotes = allNotes.slice(startMeasureIndex)
  const measureStartTimes = buildMeasureStartTimes(playNotes, sourceMeasures)
  // Where this schedule's bar lines fall, for currentMeasure() to read the
  // sounding bar off the clock.
  scheduleStartedAt = performance.now()
  scheduleFirstMeasure = startMeasureIndex
  scheduleMeasureOffsetsMs = measureStartTimes.map((ts) => tsToSeconds(ts, bpm) * 1000)
  heldAtMeasure = startMeasureIndex
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
        scheduledTimeouts.push(setTimeout(() => noteOn(n.midiNumber), startMs))
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

  transport = PLAYING
  scheduledTimeouts.push(setTimeout(() => {
    stop()
    onPlaybackEnd?.()
  }, maxEndMs + 500))
}
