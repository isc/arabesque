// The −/+ buttons beside the tempo fields on the score page (feedback
// c586857e). Typing digits is fine with a keyboard, awkward with a thumb: the
// spinner a number input draws is a few pixels tall on a desktop and absent on
// touch, so the field carries two real buttons — and holding one keeps it
// stepping instead of asking for one press per notch.
//
// The arithmetic and the repeat timer are pure. The field itself — input and
// buttons — is the same markup in both of the score page's bands, the strict
// tempo's and the playback one's, so mountBpmFields() builds it here, once;
// app.js provides what it binds to.
import { BPM_STEP } from './tempoTrainer.js'

// What the fields accept. app.js exposes them to the markup, which binds them
// as the inputs' min/max, so a typed tempo and a pressed one have one range.
export const BPM_MIN = 20
export const BPM_MAX = 300
// Where a press starts from when the field holds no tempo at all — emptied,
// or half-typed. Also the tempo a score that marks none is read at (getBPM).
export const BPM_DEFAULT = 120

// One press, one notch — the same notch the tempo trainer climbs by, so "a
// step of tempo" means one thing in the app. `direction` is -1 or +1.
export function stepBpm(current, direction) {
  const from = Number.isFinite(current) ? Math.round(current) : BPM_DEFAULT
  return Math.min(BPM_MAX, Math.max(BPM_MIN, from + direction * BPM_STEP))
}

// Long enough that a tap is never read as a hold, short enough that a thumb
// asking for a big change does not wait on it.
export const HOLD_DELAY = 450
export const HOLD_INTERVAL = 90

// A press held past HOLD_DELAY keeps stepping until it is let go. Returns the
// function that ends it, which says whether the press ever repeated: the click
// that follows such a press is the release of a hold, not a step of its own.
export function holdToRepeat(step) {
  let repeated = false
  let timer = setTimeout(function tick() {
    repeated = true
    step()
    timer = setTimeout(tick, HOLD_INTERVAL)
  }, HOLD_DELAY)
  return () => {
    clearTimeout(timer)
    return repeated
  }
}

// What tells the two fields apart: the tempo each moves, its input's id, the
// words it says (the keys hang from a prefix: …Down, …Up, …Bpm), how its
// input binds, and what disables it while a run needs the tempo to hold.
const FIELDS = {
  strictBpm: { id: 'strict-bpm', words: 'score.tempo', model: 'x-model.number', disabled: 'isStrictPlaying' },
  // Debounced: every tempo change reschedules the rest of the piece.
  playbackBpm: { id: 'playback-bpm', words: 'score.playbackTempo', model: 'x-model.number.debounce.400ms' },
}

// The component behind the markup provides bpmMin, bpmMax and bpmStep, and
// the stepBpmField / startBpmHold / endBpmHold methods (app.js).
function stepButton(field, { disabled }, direction, words) {
  return `
  <button
    type="button"
    class="pt-band-button pt-bpm-field__step"${disabled ? `
    :disabled="${disabled}"` : ''}
    :aria-label="$t('${words}')"
    @click="stepBpmField('${field}', ${direction})"
    @pointerdown="startBpmHold('${field}', ${direction})"
    @pointerup="endBpmHold('${field}')"
    @pointerleave="endBpmHold('${field}')"
    @pointercancel="endBpmHold('${field}')"
  >${direction < 0 ? '−' : '+'}</button>`
}

// A div rather than a label around the lot, since a label hands its clicks to
// the first control it holds — which would be a button.
function bpmFieldHtml(field) {
  const spec = FIELDS[field]
  if (!spec) throw new Error(`no tempo field named ${field}`)
  return `<div class="pt-bpm-field">${stepButton(field, spec, -1, `${spec.words}Down`)}
  <label class="pt-sr-only" for="${spec.id}" x-text="$t('${spec.words}Bpm')"></label>
  <input
    id="${spec.id}"
    type="number"
    :min="bpmMin"
    :max="bpmMax"
    :step="bpmStep"
    ${spec.model}="${field}"${spec.disabled ? `
    :disabled="${spec.disabled}"` : ''}
    :aria-label="$t('${spec.words}Bpm')"
  />
  <span class="pt-bpm-field__suffix" x-text="$t('score.bpm')">BPM</span>${stepButton(field, spec, 1, `${spec.words}Up`)}
</div>`
}

// Swaps each `<div data-bpm-field="<tempo>"></div>` for its field, before
// Alpine boots (a mount startAlpine() runs).
export function mountBpmFields() {
  for (const slot of document.querySelectorAll('[data-bpm-field]')) slot.outerHTML = bpmFieldHtml(slot.dataset.bpmField)
}
