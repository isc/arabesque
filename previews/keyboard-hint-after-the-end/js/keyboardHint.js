// The on-screen keyboard: a strip of piano keys under the score with the notes
// owed next lit up, for the player who has not yet made the staff-to-key reflex.
//
// It is a crutch, so it is not handed out up front. A player who reads fluently
// never sees it; it comes up when the page can tell someone is stuck on a note
// — several wrong keys tried for it, or a long wait over it — and goes away
// again once the notes are coming promptly and clean for a good stretch, the
// way a teacher's hand leaves the keyboard. The ✕ puts it away for the rest of
// the visit.
//
// hintStep is the whole of that decision, kept pure so it can be tested
// without a clock or a page; initKeyboardHint wires it to a timer, the engine
// and the DOM.
import { noteName, spelledNote, handOfNote, cLabel } from './noteExtraction.js'
import { t } from './i18n.js'

// Wrong keys tried for the same note before it is shown.
export const HINT_WRONG_NOTES = 3
// How long a note may be waited on before it is shown. Long enough that
// reading a new bar, or a breath between phrases, does not bring it up.
export const HINT_HESITATION_MS = 8000
// Notes played promptly and without a wrong key, in a row, before the keyboard
// is taken away again — and what "promptly" means.
export const HINT_FLUENT_NOTES = 16
export const HINT_FLUENT_MS = 3000
// How often the keyboard, once up, looks at where the player is. Notes played
// are seen at once, from the keypress; this catches the cursor moving by
// itself (the beat after a measure) or by a click.
const TICK_MS = 250

export function initialHint() {
  return {
    // Which note is owed (see musicxml's expectedGroup), and since when.
    key: null,
    since: 0,
    wrongs: 0,
    // A wait only counts once the player has touched the keyboard: a score
    // left open while they settle at the piano is not hesitation.
    engaged: false,
    visible: false,
    dismissed: false,
    // Notes played fluently in a row while the keyboard is up.
    streak: 0,
  }
}

const engage = (state, now) => (state.engaged ? state : { ...state, engaged: true, since: now })
const reveal = (state) => (state.visible || state.dismissed ? state : { ...state, visible: true })

// Events:
//   tick  { key, now, eligible } — where the player is; eligible is false
//         while nothing is asked of them (strict mode, listening, page hidden)
//   press { now }                — a key went down
//   wrong { now }                — and it was not the note owed
//   dismiss                      — the ✕
//   rest                         — the practice context changed (a new mode):
//                                  the next wait counts from the next keypress
//   restart                      — a run over or a piece opened: back to the
//                                  start, only the ✕ kept
export function hintStep(state, event) {
  switch (event.type) {
    case 'press':
      return engage(state, event.now)
    case 'wrong': {
      const next = { ...engage(state, event.now), wrongs: state.wrongs + 1 }
      return next.wrongs >= HINT_WRONG_NOTES ? reveal(next) : next
    }
    case 'tick': {
      const { key, now } = event
      // Waiting through a count-in or a piece being played to you is not
      // hesitating over it.
      if (!event.eligible) return { ...state, key, since: now, wrongs: 0 }
      if (key !== state.key) {
        let { visible, streak } = state
        // A note owed has been played (the one after it may not be due yet:
        // null between a measure and the beat that moves on).
        if (visible && state.key != null) {
          const fluent = state.wrongs === 0 && now - state.since < HINT_FLUENT_MS
          streak = fluent ? streak + 1 : 0
          if (streak >= HINT_FLUENT_NOTES) {
            visible = false
            streak = 0
          }
        }
        return { ...state, key, since: now, wrongs: 0, visible, streak }
      }
      if (state.engaged && key != null && now - state.since >= HINT_HESITATION_MS) return reveal(state)
      return state
    }
    case 'dismiss':
      return { ...state, visible: false, dismissed: true }
    case 'rest':
      return { ...state, engaged: false, wrongs: 0 }
    case 'restart':
      return { ...initialHint(), dismissed: state.dismissed }
    default:
      return state
  }
}

const A0 = 21
const C8 = 108
const MIDDLE_C = 60
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])
const isBlackKey = (midi) => BLACK_PITCH_CLASSES.has(midi % 12)

// The keys to draw for a score: whole octaves, C to B, around every note it
// asks for, and never fewer than two — a single octave gives the eye nothing
// to find its place by. Clamped to a real piano's 88 keys.
export function keyboardRange(midiNumbers) {
  if (midiNumbers.length === 0) return { low: 48, high: 71 }
  let low = Math.floor(Math.min(...midiNumbers) / 12) * 12
  let high = Math.floor(Math.max(...midiNumbers) / 12) * 12 + 11
  if (high - low < 23) {
    // Grow toward middle C, where the other hand usually is.
    if (low >= MIDDLE_C) low -= 12
    else high += 12
  }
  return { low: Math.max(A0, low), high: Math.min(C8, high) }
}

// The keys of a range, each white key with its position among the white keys,
// each black key with the position of the gap it sits over.
export function keyLayout({ low, high }) {
  const keys = []
  let whites = 0
  for (let midi = low; midi <= high; midi++) {
    const black = isBlackKey(midi)
    keys.push({ midi, black, at: black ? whites : whites++ })
  }
  return { keys, whites }
}

// The notes owed, by name, a hand at a time and low to high within it:
// [{ hand: 'main droite', notes: ['mi5'] }, { hand: 'main gauche', notes: ['do2', 'do3'] }].
function caption(notes) {
  return ['right', 'left']
    .map((hand) => ({
      hand: t(`hands.${hand}`),
      notes: notes
        .filter((n) => handOfNote(n) === hand)
        .sort((a, b) => a.midiNumber - b.midiNumber)
        .map(spelledNote),
    }))
    .filter((group) => group.notes.length)
}

export function initKeyboardHint({ expectedGroup, eligible, onVisibleChange, onCaptionChange, now = () => performance.now() }) {
  let state = initialHint()
  // While the keyboard is up, the page follows the player at TICK_MS, so the
  // lit keys move with the cursor however it moved (the beat that ends a
  // measure, a click on another bar). While it is down, a single timer waits
  // for the moment a wait would become hesitation, and nothing runs at all
  // once it has been put away.
  let following = null
  let waiting = null
  let container = null
  // midi → { key, name }: the key's element and the span naming it when lit.
  let keyElements = new Map()
  // Keys down right now, and whether each was right.
  const held = new Map()
  // The notes the caption and the scroll were last set for.
  let paintedOwed = ''
  let centring = 0

  function dispatch(event) {
    const before = state.visible
    state = hintStep(state, event)
    if (state.visible === before) return
    paintedOwed = ''
    clearInterval(following)
    following = state.visible ? setInterval(tick, TICK_MS) : null
    onVisibleChange(state.visible)
  }

  // Forgets the keys held and the wait under way, then rests or restarts.
  function startOver(type) {
    held.clear()
    clearTimeout(waiting)
    dispatch({ type })
  }

  function tick() {
    const group = expectedGroup()
    const asked = eligible()
    dispatch({ type: 'tick', key: group?.key ?? null, now: now(), eligible: asked })
    // Up but out of sight (strict mode, listening): nothing to draw.
    if (state.visible) {
      if (asked) paint(group)
    } else armWait()
  }

  // Looks again when the note waited on would have been waited on too long —
  // or shortly, when nothing is owed yet because the beat that moves on to the
  // next measure has not come.
  function armWait() {
    clearTimeout(waiting)
    if (!state.engaged || state.dismissed) return
    const delay = state.key == null ? TICK_MS : state.since + HINT_HESITATION_MS - now()
    waiting = setTimeout(tick, Math.max(0, delay))
  }

  function paint(group) {
    if (!container) return
    const owed = new Map((group?.notes ?? []).map((n) => [n.midiNumber, n]))
    for (const [midi, { key, name }] of keyElements) {
      const note = owed.get(midi)
      const press = held.get(midi)
      key.classList.toggle('is-owed', !!note && press !== 'ok')
      key.classList.toggle('is-right', press === 'ok')
      key.classList.toggle('is-wrong', press === 'wrong')
      key.classList.toggle('is-lit', !!note || !!press)
      const text = note ? noteName(note) : ''
      if (name.textContent !== text) name.textContent = text
    }
    // Between two measures nothing is owed for a moment: the caption keeps
    // the last note rather than blinking empty.
    const owedSignature = [...owed.keys()].join()
    if (owedSignature === paintedOwed || !owed.size) return
    paintedOwed = owedSignature
    onCaptionChange(caption([...owed.values()]))
    centre([...owed.keys()])
  }

  // On a phone the score's range can be wider than the screen: keep what is
  // owed in the middle of the strip. Measured at the next frame rather than in
  // the keypress that called for it, where reading a layout would force one
  // for the whole score. The strip may not be laid out yet on the tick that
  // brings it up — the page shows it in its own time — so a strip with no
  // width is looked at again, for as long as it is meant to be seen.
  function centre(midis) {
    cancelAnimationFrame(centring)
    centring = requestAnimationFrame(() => {
      const scroller = container.parentElement
      if (!scroller.clientWidth) {
        if (state.visible && eligible()) centre(midis)
        return
      }
      if (scroller.scrollWidth <= scroller.clientWidth) return
      const keys = midis.map((m) => keyElements.get(m).key)
      const left = Math.min(...keys.map((el) => el.offsetLeft))
      const right = Math.max(...keys.map((el) => el.offsetLeft + el.offsetWidth))
      scroller.scrollLeft = (left + right) / 2 - scroller.clientWidth / 2
    })
  }

  return {
    // Draws the keys a score needs into `el`.
    mount(el, midiNumbers) {
      container = el
      const { keys, whites } = keyLayout(keyboardRange(midiNumbers))
      el.style.setProperty('--whites', whites)
      el.replaceChildren()
      keyElements = new Map()
      for (const { midi, black, at } of keys) {
        const key = document.createElement('div')
        key.className = black ? 'pt-keyhint__key is-black' : 'pt-keyhint__key'
        key.style.setProperty('--at', at)
        key.dataset.midi = midi
        const name = document.createElement('span')
        name.className = 'pt-keyhint__name'
        key.append(name)
        if (!black && midi % 12 === 0) {
          const c = document.createElement('span')
          c.className = 'pt-keyhint__c'
          // C, with its octave, is written on every C key: the landmark a
          // beginner counts from.
          c.textContent = cLabel(midi)
          key.append(c)
        }
        keyElements.set(midi, { key, name })
        el.append(key)
      }
      startOver('restart')
    },
    // After the engine has had the keypress (see app.js): whether it was a
    // wrong note is already known by then, through wrongNote.
    // Keys only count where the keyboard could come up: a wrong note tried
    // while strict mode is selected must not have it waiting on the next tab.
    // Once put away it never comes back, so they are not followed at all.
    keyDown(midi) {
      if (state.dismissed) return
      if (!held.has(midi)) held.set(midi, 'ok')
      if (eligible()) dispatch({ type: 'press', now: now() })
      tick()
    },
    wrongNote(midi) {
      if (state.dismissed) return
      held.set(midi, 'wrong')
      if (!eligible()) return
      // Catch up with a cursor that moved by itself first (a run starting, the
      // beat that begins a repetition), or keyDown's tick would see a new note
      // and drop this key from its count.
      tick()
      dispatch({ type: 'wrong', now: now() })
    },
    keyUp(midi) {
      if (state.dismissed) return
      held.delete(midi)
      if (state.visible) tick()
    },
    dismiss() {
      clearTimeout(waiting)
      dispatch({ type: 'dismiss' })
    },
    rest() {
      startOver('rest')
    },
    restart() {
      startOver('restart')
    },
  }
}
