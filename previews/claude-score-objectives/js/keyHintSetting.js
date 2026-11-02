// Whether the on-screen keyboard (keyboardHint.js) is put away, for the profile
// holding the device. The ✕ puts it away for the rest of the day: a child
// playing with it instead of listening to the teacher closes it once, not at
// every score (feedback 4d8a81b9), and a beginner wants it back tomorrow. A
// player who reads fluently was paying that ✕ at every session (feedback
// dea5ac23), so it can also be put away for good — from the strip, at the
// moment it is in the way, or from the ⚙️ menu, which is also the way back.
//
// One key for both, holding the day of the ✕ or NEVER: letting it back clears
// either. Kept out of keyboardHint.js because the menu, on every page, needs
// only this.
import { localDayKey } from './days.js'
import { scopedKey } from './profiles.js'

const KEY = scopedKey('arabesque:keyhint-dismissed')
const NEVER = 'never'
// Told when the setting changes, for the strip on the page to follow.
export const KEY_HINT_SETTING_EVENT = 'arabesque:keyhint-setting'

function read() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function write(value) {
  try {
    if (value == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, value)
  } catch {
    /* storage refused: the choice holds until the strip next starts over */
  }
}

// The menu's setting: not put away for good.
export const keyHintAllowed = () => read() !== NEVER

// Put away right now, for good or for today.
export function keyHintPutAway() {
  const value = read()
  return value === NEVER || value === localDayKey(new Date())
}

// The ✕.
export function putKeyHintAwayForToday() {
  write(localDayKey(new Date()))
}

// "Jamais", or "Si besoin", which forgets today's ✕ as well: asking for it back
// is asking for it now.
export function storeKeyHintAllowed(allowed) {
  write(allowed ? null : NEVER)
  window.dispatchEvent(new Event(KEY_HINT_SETTING_EVENT))
}
