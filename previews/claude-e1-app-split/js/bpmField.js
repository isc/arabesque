// The tempo field in both of the score page's bands, the strict tempo's and
// the playback one's: an input, and the −/+ buttons that step it by a notch and
// keep stepping while held (bpmStepper.js, feedback c586857e). The same field
// in both places, so its markup is built here once and mounted before Alpine
// boots (startAlpine), and its behaviour is a mixin the page's component
// spreads, as headerMenu.js does for the menu. The component provides the
// tempi the fields move (strictBpm, playbackBpm), isStrictPlaying, and
// commitBpm(field), which keeps a tempo once a press is over (app.js).
import { stepBpm, holdToRepeat, BPM_MIN, BPM_MAX } from './bpmStepper.js'
import { BPM_STEP } from './tempoTrainer.js'

export function bpmField() {
  return {
    // The hold in progress, if any (the function that ends it), and whether
    // the press that just ended ever repeated — the click it ends with fires
    // after the release, and is the one that needs the answer. A hold ticks
    // some eleven times a second, so the page's watches sit one out and the
    // release commits once (see commitBpm).
    bpmHold: null,
    bpmRepeated: false,

    // `field` is the tempo the buttons move ('strictBpm' or 'playbackBpm'),
    // `direction` -1 or +1. Typing a tempo still works — this is the way to
    // change one with a thumb.
    startBpmHold(field, direction) {
      // Whatever was held before — a second finger on the other button, or a
      // press let go somewhere else — is ended rather than left ticking: the
      // chain re-arms itself, so an orphan would step the tempo for the life of
      // the page. Two buttons, one hold.
      this.endBpmHold(field)
      this.bpmRepeated = false
      this.bpmHold = holdToRepeat(() => { this[field] = stepBpm(this[field], direction) })
    },

    // The end of a press: stops the repeat and commits the tempo it held back.
    // Taken from pointerup, and from the pointer leaving the button or the
    // gesture being taken over — a press let go off the button never becomes a
    // click, and its chain would tick on.
    //
    // Whether it repeated outlives the hold, because the click that ends the
    // press has not fired yet. A touch fires pointerleave on the way out of a
    // press it has already released, which is why an ended hold is not ended a
    // second time — that would forget the answer with the click still to come.
    endBpmHold(field) {
      if (!this.bpmHold) return
      this.bpmRepeated = this.bpmHold()
      this.bpmHold = null
      if (this.bpmRepeated) this.commitBpm(field)
    },

    stepBpmField(field, direction) {
      // A press is a click, whatever pressed it — mouse, thumb, Entrée on the
      // focused button — so the notch is stepped here. The click that ends a
      // repeating hold is its release, not one notch more.
      const repeated = this.bpmRepeated
      this.bpmRepeated = false
      if (!repeated) this[field] = stepBpm(this[field], direction)
    },
  }
}

// What tells the two fields apart: the tempo each moves, its input's id, the
// words it says (the keys hang from a prefix: …Down, …Up, …Bpm), how its input
// binds, and what disables it while a run needs the tempo to hold.
const FIELDS = {
  strictBpm: { id: 'strict-bpm', words: 'score.tempo', model: 'x-model.number', disabled: 'isStrictPlaying' },
  // Debounced: every tempo change reschedules the rest of the piece.
  playbackBpm: { id: 'playback-bpm', words: 'score.playbackTempo', model: 'x-model.number.debounce.400ms' },
}

function stepButton(field, disabled, direction, words) {
  return `
  <button
    type="button"
    class="pt-band-button pt-bpm-field__step"${disabled}
    :aria-label="$t('${words}')"
    @click="stepBpmField('${field}', ${direction})"
    @pointerdown="startBpmHold('${field}', ${direction})"
    @pointerup="endBpmHold('${field}')"
    @pointerleave="endBpmHold('${field}')"
    @pointercancel="endBpmHold('${field}')"
  >${direction < 0 ? '−' : '+'}</button>`
}

// A div rather than a label around the lot, since a label hands its clicks to
// the first control it holds — which would be a button. The input accepts
// exactly what the buttons reach, and its arrow keys move the same notch.
function fieldHtml(field) {
  const spec = FIELDS[field]
  if (!spec) throw new Error(`no tempo field named ${field}`)
  const disabled = spec.disabled ? `\n    :disabled="${spec.disabled}"` : ''
  return `<div class="pt-bpm-field">${stepButton(field, disabled, -1, `${spec.words}Down`)}
  <label class="pt-sr-only" for="${spec.id}" x-text="$t('${spec.words}Bpm')"></label>
  <input
    id="${spec.id}"
    type="number"
    min="${BPM_MIN}"
    max="${BPM_MAX}"
    step="${BPM_STEP}"
    ${spec.model}="${field}"${disabled}
  />
  <span class="pt-bpm-field__suffix" x-text="$t('score.bpm')">BPM</span>${stepButton(field, disabled, 1, `${spec.words}Up`)}
</div>`
}

// Swaps each `<div data-bpm-field="<tempo>"></div>` for its field: one of the
// mounts startAlpine() runs before Alpine boots.
export function mountBpmFields() {
  for (const slot of document.querySelectorAll('[data-bpm-field]')) slot.outerHTML = fieldHtml(slot.dataset.bpmField)
}
