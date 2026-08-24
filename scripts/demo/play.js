// Drives the score page for a screenshot or a demo recording, through the same
// mock MIDI input the test suite uses. Injected into a throwaway copy of
// public/ by capture.sh — never served to real users.
//
// Nothing here fakes the result: the notes sent are the ones the app itself is
// waiting for (extractNotesFromScore is the app's own reading of the sheet),
// and it is the app that decides what turns green. Only the source of the MIDI
// bytes differs from a keyboard on the desk.
//
// Query parameters, all optional:
//   demoplay=<n>     play the first n beats of the piece
//   demowrong=<n>    before beat n, hit a neighbouring key — shows the app
//                    rejecting a wrong note
//   demoscroll=<px>  scroll the score by that much once played, to frame the
//                    music rather than the title block
//   democlick=<text> click the button whose label contains that text
import { extractNotesFromScore } from './js/noteExtraction.js'

const params = new URLSearchParams(location.search)
const BEATS = Number(params.get('demoplay') || 0)
const WRONG_AT = Number(params.get('demowrong') || 0)
const SCROLL = Number(params.get('demoscroll') || 0)
const CLICK = params.get('democlick')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function dispatchMidi(bytes) {
  window.dispatchEvent(new CustomEvent('mock-midi-input', { detail: { data: bytes } }))
}

async function strike(midiNotes, holdMs = 90) {
  for (const note of midiNotes) dispatchMidi([144, note, 80])
  await sleep(holdMs)
  for (const note of midiNotes) dispatchMidi([128, note, 64])
}

async function waitFor(test, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = test()
    if (value) return value
    await sleep(100)
  }
  return null
}

// Beats, in order: simultaneous notes grouped so chords are struck together,
// which is what the engine expects.
function beatsOf(osmd) {
  const { allNotes } = extractNotesFromScore(osmd)
  // allNotes is one entry per measure, each carrying its own notes.
  const notes = allNotes.flatMap((measure) => measure.notes || []).filter((n) => !n.isGrace)
  const beats = []
  for (const note of notes) {
    const last = beats[beats.length - 1]
    if (last && last.timestamp === note.timestamp) last.notes.push(note)
    else beats.push({ timestamp: note.timestamp, notes: [note] })
  }
  return beats
}

async function playOpening() {
  const osmd = await waitFor(() => window.osmdInstance)
  await waitFor(() => document.querySelector('#score[data-render-complete]'))
  await sleep(600)

  const beats = beatsOf(osmd)
  if (!beats.length) return

  for (const [index, beat] of beats.slice(0, BEATS).entries()) {
    const midi = [...new Set(beat.notes.map((n) => n.midiNumber).filter(Boolean))]
    if (!midi.length) continue

    // A semitone off the real note: close enough to be a believable slip, and
    // the app has to reject it for the demonstration to mean anything.
    if (WRONG_AT && index + 1 === WRONG_AT) {
      await strike([midi[0] + 1], 140)
      await sleep(700)
    }

    await strike(midi)
    await sleep(210)
  }
}

// Scroll past the sheet's title block so the frame opens on the music, which is
// where a player's eyes are once a piece is under way.
async function scrollToMusic() {
  await waitFor(() => document.querySelector('#score[data-render-complete]'))
  await sleep(400)
  const scroller = [document.querySelector('#score'), document.scrollingElement, document.body].find(
    (el) => el && el.scrollHeight > el.clientHeight + SCROLL
  )
  if (scroller) scroller.scrollTop = SCROLL
}

// Open a panel the simulator has no way to tap.
async function clickByText(text) {
  const button = await waitFor(() =>
    [...document.querySelectorAll('button, [role="button"]')].find((b) => b.textContent.includes(text))
  )
  button?.click()
}

if (BEATS > 0 || SCROLL > 0 || CLICK) {
  // The mock backend only takes over when the app thinks it is under test, and
  // midi.js decides which one to connect at load — so the cookie has to be set
  // before that, which costs one reload.
  if (!document.cookie.includes('test-env')) {
    document.cookie = 'test-env=true; path=/'
    location.reload()
  } else {
    if (BEATS > 0) await playOpening()
    if (SCROLL > 0) await scrollToMusic()
    if (CLICK) {
      await sleep(500)
      await clickByText(CLICK)
    }
  }
}
