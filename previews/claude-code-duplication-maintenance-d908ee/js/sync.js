// Cloud sync of training data (sessions + fingerings) for the signed-in user.
//
// Why it's conflict-free: you can't play two piano sessions at once, so sessions
// across devices are disjoint in time with unique ids — sync is a plain union by
// id. Fingerings are last-write-wins by updatedAt (the workflow always pulls
// before editing). Aggregates are never synced: they're recomputed locally from
// sessions after a pull.
//
// One sync covers one profile — the one whose database the page has open —
// plus the list of profiles itself, which every device keeps in step
// (profiles.js): a profile added on the iPad reaches the phone with the next
// sync there, a profile removed anywhere is dropped everywhere, and its rows
// on the server go with it.
//
// runSync() takes its dependencies (the supabase client, storage,
// practiceTracker) so it stays page-agnostic.
import { currentProfileId, mergeProfiles, scopedKey } from './profiles.js'

// Per profile: the throttle in autoSync.js reads it, and a profile just
// switched to has its own catching up to do.
const lastSyncKey = (profileId) => scopedKey('arabesque:last-sync', profileId)
const CHUNK = 200

export function lastSyncAt(profileId = currentProfileId()) {
  try {
    return localStorage.getItem(lastSyncKey(profileId))
  } catch {
    return null
  }
}

function setLastSync(iso, profileId) {
  try {
    localStorage.setItem(lastSyncKey(profileId), iso)
  } catch {
    /* ignore */
  }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Map scoreId → { title, composer } from the score catalog, so aggregates
// rebuilt from pulled sessions keep their titles (sessions don't store them).
// Memoized: the catalog can't change within a page load, and syncs are now
// frequent enough that re-fetching and re-mapping it each time is pure waste.
let catalogMeta = null

export async function fetchCatalogMeta() {
  if (catalogMeta) return catalogMeta
  try {
    const res = await fetch('data/scores.json')
    const data = await res.json()
    const base = data.baseUrl || ''
    const map = {}
    for (const s of data.scores || []) {
      if (Array.isArray(s.parts)) {
        for (const p of s.parts) map[base + p.file] = { title: p.title, composer: s.composer }
      } else if (s.file) {
        map[base + s.file] = { title: s.title, composer: s.composer }
      }
    }
    catalogMeta = map
    return map
  } catch {
    return {}
  }
}

// Pull missing sessions, push local-only sessions, reconcile fingerings, then
// recompute aggregates if anything was pulled. Returns a summary; throws on a
// hard error so the caller can surface it.
// `userId` comes from the caller's local session when it has one: getUser() is
// a network round-trip against /auth/v1/user, and at the automatic trigger rate
// that would be one wasted request per playthrough and per tab switch.
export async function runSync({ supabase, storage, practiceTracker, userId = null, profileId = currentProfileId() }) {
  let uid = userId
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in')
    uid = user.id
  }

  // The three reads are independent; the pushes below wait on all of them.
  const [profilesRead, idsRead, stampsRead] = await Promise.all([
    supabase.from('profiles').select('id, name, avatar, updated_at, deleted'),
    supabase.from('training_sessions').select('id').eq('profile_id', profileId),
    // Stamps only. The blobs are fetched below for the scores that actually
    // won, which is usually none: selecting '*' here meant re-downloading the
    // entire fingering corpus on every sync, and syncs are no longer rare.
    supabase.from('user_fingerings').select('score_url, updated_at').eq('profile_id', profileId),
  ])
  for (const { error } of [profilesRead, idsRead, stampsRead]) if (error) throw error

  // --- Profiles (last-write-wins, tombstones for removals) ---
  // A tombstone pushed takes the profile's rows with it: the server drops
  // them itself (supabase/sync.sql), for every client that ever pushes one.
  const { toPush: profilesToPush, changed: profilesChanged } = mergeProfiles(profilesRead.data)
  if (profilesToPush.length) {
    const { error } = await supabase.from('profiles').upsert(profilesToPush.map((row) => ({ ...row, user_id: uid })))
    if (error) throw error
  }
  if (profilesRead.data.some((r) => r.id === profileId && r.deleted)) {
    // The profile this page is on was removed from another device: its data
    // is not to be pushed, and what the page holds goes when it closes.
    setLastSync(new Date().toISOString(), profileId)
    return { pushed: 0, pulled: 0, fingeringsPushed: 0, fingeringsPulled: 0, profilesChanged }
  }

  // --- Sessions (union by id) ---
  const remoteIdRows = idsRead.data
  const remoteIdList = remoteIdRows.map((r) => r.id)
  const remoteIds = new Set(remoteIdList)

  const localSessions = (await storage.getSessions()).filter((s) => s.endedAt && s.measures?.length)
  const localIds = new Set(localSessions.map((s) => s.id))

  const toPush = localSessions.filter((s) => !remoteIds.has(s.id))
  for (const part of chunk(toPush, CHUNK)) {
    const rows = part.map((s) => ({ user_id: uid, profile_id: profileId, id: s.id, data: s, ended_at: s.endedAt }))
    const { error } = await supabase.from('training_sessions').upsert(rows)
    if (error) throw error
  }

  const missingIds = remoteIdList.filter((id) => !localIds.has(id))
  let pulled = 0
  for (const part of chunk(missingIds, CHUNK)) {
    const { data: rows, error } = await supabase.from('training_sessions').select('data').eq('profile_id', profileId).in('id', part)
    if (error) throw error
    for (const row of rows) {
      await storage.saveSession(row.data)
      pulled++
    }
  }

  // --- Fingerings (last-write-wins by updatedAt) ---
  const localFingerings = await storage.getAllFingerings()
  const remoteStamps = stampsRead.data
  const remoteByUrl = new Map(remoteStamps.map((r) => [r.score_url, r]))
  const localByUrl = new Map(localFingerings.map((f) => [f.scoreUrl, f]))

  const fingeringsToPush = localFingerings
    .filter((f) => {
      const r = remoteByUrl.get(f.scoreUrl)
      return !r || (f.updatedAt || 0) > Number(r.updated_at)
    })
    .map((f) => ({ user_id: uid, profile_id: profileId, score_url: f.scoreUrl, fingerings: f.fingerings, updated_at: f.updatedAt || 0 }))
  if (fingeringsToPush.length) {
    const { error } = await supabase.from('user_fingerings').upsert(fingeringsToPush)
    if (error) throw error
  }

  const staleUrls = remoteStamps
    .filter((r) => {
      const local = localByUrl.get(r.score_url)
      return !local || Number(r.updated_at) > (local.updatedAt || 0)
    })
    .map((r) => r.score_url)

  let fingeringsPulled = 0
  for (const part of chunk(staleUrls, CHUNK)) {
    const { data: rows, error } = await supabase
      .from('user_fingerings')
      .select('score_url, fingerings, updated_at')
      .eq('profile_id', profileId)
      .in('score_url', part)
    if (error) throw error
    for (const r of rows) {
      await storage.putFingeringRecord({
        scoreUrl: r.score_url,
        fingerings: r.fingerings,
        updatedAt: Number(r.updated_at),
      })
      fingeringsPulled++
    }
  }

  // --- Recompute aggregates locally if we pulled any sessions ---
  if (pulled > 0) {
    const meta = await fetchCatalogMeta()
    await practiceTracker.rebuildAggregates((scoreId) => meta[scoreId] ?? null)
  }

  setLastSync(new Date().toISOString(), profileId)
  return { pushed: toPush.length, pulled, fingeringsPushed: fingeringsToPush.length, fingeringsPulled, profilesChanged }
}
