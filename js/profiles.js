// Several people on one device, each with a practice history of their own.
//
// A profile is a name, an avatar and a place to keep data. Every profile has
// an IndexedDB database of its own (storage.js opens the one named by
// scopedKey), and the few localStorage keys that carry practice state — the
// session snapshot a page teardown leaves behind, the strict tempo chosen per
// score — are suffixed with the profile's id the same way. Everything else the
// device holds (language, account, where the sound comes out, the changelog
// dot) belongs to the device rather than to whoever is holding it, and stays
// shared.
//
// The first profile is the one that existed before profiles did. It keeps the
// database name and the keys it always had, so a device that never adds a
// second profile sees no change at all — not even a write to localStorage:
// the list is only stored once someone adds to it.
//
// It is also the only profile that syncs (syncsToCloud). The account is signed
// in on the device, and a child's sessions must not be pushed under the
// parent's account, nor the parent's history pulled into the child's journal.
// Until the server knows about profiles, the others are local to the device.
//
// Which profile is current is read at page load and never changes within a
// page: switching writes the new id and navigates, so that every module that
// derived a name from it at import time (storage, practiceTracker) starts over
// on the right one.
import { t } from './i18n.js'

const PROFILES_KEY = 'arabesque:profiles'
export const MAIN_PROFILE_ID = 'main'
// What a scoped storage name carries after its base (scopedKey).
const SCOPE_SEPARATOR = '@'

// The avatars on offer. Emoji rather than pictures so a profile is one short
// string wherever it goes. The first is the main profile's.
export const AVATARS = ['🎹', '🐻', '🦊', '🐱', '🐼', '🦁', '🐸', '🦄', '🐧', '🐙', '🌟', '🎈']

// The main profile as it exists before anyone names it. The empty name is
// filled in by profileName in the current language, and stored only once it
// is edited or a second profile is added.
function mainProfile() {
  return { id: MAIN_PROFILE_ID, name: '', avatar: AVATARS[0] }
}

// The stored state, normalised: the main profile always first, the current
// id always one of the list. A stored id that no profile carries any more
// (removed from another tab, hand-edited) falls back to the main profile
// rather than to a database nobody can reach from the UI. Parsed once per
// page — the value only changes through writeState below.
let cached = null

function readState() {
  if (cached) return cached
  let stored = null
  try {
    stored = JSON.parse(localStorage.getItem(PROFILES_KEY))
  } catch {
    /* no localStorage, or a value nothing here wrote */
  }
  const listed = Array.isArray(stored?.profiles) ? stored.profiles : []
  const profiles = listed.some((p) => p.id === MAIN_PROFILE_ID) ? listed : [mainProfile(), ...listed]
  const current = profiles.some((p) => p.id === stored?.current) ? stored.current : MAIN_PROFILE_ID
  cached = { current, profiles }
  return cached
}

function writeState(state) {
  cached = null
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(state))
  } catch {
    /* no localStorage: profiles are a per-page affair then */
  }
}

export function listProfiles() {
  return readState().profiles
}

export function currentProfileId() {
  return readState().current
}

export function currentProfile() {
  const { current, profiles } = readState()
  return profiles.find((p) => p.id === current)
}

// What a profile is called on screen: the main one has no name until someone
// gives it one.
export function profileName(profile) {
  return profile.name || t('profiles.defaultName')
}

// The first avatar no profile wears yet — so two profiles made in a row don't
// come out twins — or the first of all once they are all taken.
export function freeAvatar() {
  const taken = new Set(listProfiles().map((p) => p.avatar))
  return AVATARS.find((a) => !taken.has(a)) ?? AVATARS[0]
}

// Whether the current profile's data goes to the account signed in on this
// device. See the header: only the main profile does, for now.
export function syncsToCloud() {
  return currentProfileId() === MAIN_PROFILE_ID
}

// A storage name (IndexedDB database, localStorage key) made the profile's
// own. The main profile's names are the bare ones it always had.
export function scopedKey(base, profileId = currentProfileId()) {
  return profileId === MAIN_PROFILE_ID ? base : `${base}${SCOPE_SEPARATOR}${profileId}`
}

export function addProfile({ name, avatar = AVATARS[0] }) {
  const state = readState()
  const profile = { id: `p-${Date.now().toString(36)}`, name: name.trim(), avatar }
  writeState({ ...state, profiles: [...state.profiles, profile] })
  return profile
}

export function updateProfile(id, patch) {
  const state = readState()
  if (typeof patch.name === 'string') patch = { ...patch, name: patch.name.trim() }
  writeState({ ...state, profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
}

// Forgets the profile and the localStorage keys scoped to it. Its database is
// storage.js's to drop (dropProfileStorage): this module knows the naming
// rule, not the store. The main profile cannot go — it is where the account's
// data lives, and the one every fallback lands on.
export function removeProfile(id) {
  if (id === MAIN_PROFILE_ID) throw new Error('The main profile cannot be removed')
  const state = readState()
  writeState({
    current: state.current === id ? MAIN_PROFILE_ID : state.current,
    profiles: state.profiles.filter((p) => p.id !== id),
  })
  try {
    const suffix = `${SCOPE_SEPARATOR}${id}`
    // Collected first: removing while walking by index skips every other key.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const key of keys) if (key.endsWith(suffix)) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

// Makes a profile current for the next page load. The caller navigates: see
// the header for why nothing in the current page is expected to follow.
export function switchProfile(id) {
  const state = readState()
  if (!state.profiles.some((p) => p.id === id)) return
  writeState({ ...state, current: id })
}
