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
// Every profile syncs under the account signed in on the device, each on its
// own: sessions and fingerings carry the profile's id on the server, and so
// does the list of profiles itself (sync.js), so that a profile made on the
// iPad shows up on the phone. A removed profile leaves a tombstone behind
// (`removed`), which is what tells the other devices to drop it rather than
// push it back. Every entry carries the stamp of its last change, live or
// removed: the newest wins, and a tombstone wins a tie.
//
// Which profile is current is read at page load and never changes within a
// page: switching writes the new id and navigates, so that every module that
// derived a name from it at import time (storage, practiceTracker) starts over
// on the right one.
import { t } from './i18n.js'

const PROFILES_KEY = 'arabesque:profiles'
export const MAIN_PROFILE_ID = 'main'
// What a scoped storage name carries after its base (scopedKey).
export const SCOPE_SEPARATOR = '@'

// The avatars on offer. Emoji rather than pictures so a profile is one short
// string wherever it goes. The first is the main profile's.
export const AVATARS = ['🎹', '🐻', '🦊', '🐱', '🐼', '🦁', '🐸', '🦄', '🐧', '🐙', '🌟', '🎈']

// The main profile as it exists before anyone names it. The empty name is
// filled in by profileName in the current language, and stored only once it
// is edited or a second profile is added.
function mainProfile() {
  return { id: MAIN_PROFILE_ID, name: '', avatar: AVATARS[0], updatedAt: 0 }
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
  // Profiles stored before they carried a stamp get the oldest one there is:
  // whatever any other device says about them is newer.
  const listed = (Array.isArray(stored?.profiles) ? stored.profiles : []).map((p) => ({ updatedAt: 0, ...p }))
  const profiles = listed.some((p) => p.id === MAIN_PROFILE_ID) ? listed : [mainProfile(), ...listed]
  const current = profiles.some((p) => p.id === stored?.current) ? stored.current : MAIN_PROFILE_ID
  const removed = Array.isArray(stored?.removed) ? stored.removed : []
  cached = { current, profiles, removed }
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

// A storage name (IndexedDB database, localStorage key) made the profile's
// own. The main profile's names are the bare ones it always had.
export function scopedKey(base, profileId = currentProfileId()) {
  return profileId === MAIN_PROFILE_ID ? base : `${base}${SCOPE_SEPARATOR}${profileId}`
}

// An id unlike any other device's: the same second on two iPads must not
// make one profile out of two.
function newId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function addProfile({ name, avatar = AVATARS[0] }) {
  const state = readState()
  const profile = { id: newId(), name: name.trim(), avatar, updatedAt: Date.now() }
  writeState({ ...state, profiles: [...state.profiles, profile] })
  return profile
}

export function updateProfile(id, patch) {
  const state = readState()
  if (typeof patch.name === 'string') patch = { ...patch, name: patch.name.trim() }
  writeState({
    ...state,
    profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
  })
}

// Forgets the profile and the localStorage keys scoped to it, and leaves a
// tombstone for sync to carry to the other devices. Its database is dropped
// by storage.js the next time one opens (pruneProfileStorage): this module
// knows the naming rule, not the store. The main profile cannot go — it is
// the one every fallback lands on.
export function removeProfile(id) {
  if (id === MAIN_PROFILE_ID) throw new Error('The main profile cannot be removed')
  const state = readState()
  writeState({
    current: state.current === id ? MAIN_PROFILE_ID : state.current,
    profiles: state.profiles.filter((p) => p.id !== id),
    removed: [...state.removed.filter((r) => r.id !== id), { id, updatedAt: Date.now() }],
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

// --- What sync exchanges (sync.js) ---

// A tombstone older than this has been seen by every device that will ever
// sync again; keeping it would only make the list longer.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

const toRow = (e) => ({ id: e.id, name: e.deleted ? '' : e.name, avatar: e.deleted ? '' : e.avatar, updated_at: e.updatedAt, deleted: e.deleted })

// Merges the server's rows with this device's, both ways. Per id the newest
// entry wins, a tombstone winning a tie, so a profile this device never saw
// is added, a newer name or avatar replaces the old, and a removal from
// elsewhere removes here too. Returns the rows the server lacks or has older
// (`toPush`) and whether anything changed here (`changed`).
export function mergeProfiles(remoteRows) {
  const state = readState()
  const remote = new Map(remoteRows.map((r) => [r.id, { id: r.id, name: r.name, avatar: r.avatar, updatedAt: Number(r.updated_at), deleted: !!r.deleted }]))
  const newer = (a, b) => !b || a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.deleted && !b.deleted)
  const merged = new Map()
  const offer = (entry) => {
    if (newer(entry, merged.get(entry.id))) merged.set(entry.id, entry)
  }
  for (const p of state.profiles) offer({ ...p, deleted: false })
  for (const r of state.removed) offer({ id: r.id, updatedAt: r.updatedAt, deleted: true })
  for (const e of remote.values()) offer(e)

  const entries = [...merged.values()]
  const horizon = Date.now() - TOMBSTONE_TTL_MS
  const next = {
    current: state.current,
    profiles: entries.filter((e) => !e.deleted).map(({ deleted, ...p }) => p),
    removed: entries.filter((e) => e.deleted && e.updatedAt > horizon).map(({ id, updatedAt }) => ({ id, updatedAt })),
  }
  if (!next.profiles.some((p) => p.id === next.current)) next.current = MAIN_PROFILE_ID
  const changed = JSON.stringify(next) !== JSON.stringify(state)
  if (changed) writeState(next)
  return { changed, toPush: entries.filter((e) => newer(e, remote.get(e.id))).map(toRow) }
}
