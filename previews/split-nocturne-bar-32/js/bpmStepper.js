// The −/+ buttons beside the tempo fields on the score page (feedback
// c586857e). Typing digits is fine with a keyboard, awkward with a thumb: the
// spinner a number input draws is a few pixels tall on a desktop and absent on
// touch, so the field carries two real buttons — and holding one keeps it
// stepping instead of asking for one press per notch.
//
// Pure: the arithmetic and the repeat timer, nothing about the DOM. app.js
// wires them to both fields (the strict tempo and the playback one).
import { BPM_STEP } from './tempoTrainer.js'

// What the fields accept. app.js exposes them to the markup, which binds them
// as the inputs' min/max, so a typed tempo and a pressed one have one range.
export const BPM_MIN = 20
export const BPM_MAX = 300
// Where a press starts from when the field holds no tempo at all — emptied,
// or half-typed. Same tempo strict mode opens on.
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
