// Cloud sync of training data (sessions + fingerings) for the signed-in user.
//
// Why it's conflict-free: you can't play two piano sessions at once, so sessions
// across devices are disjoint in time with unique ids — sync is a plain union by
// id. Fingerings are one record per score, which goes up or comes down whole,
// and are merged note by note when both sides changed since they last met
// (mergeFingerings). Aggregates are never synced: they're recomputed locally
// from sessions after a pull.
//
// One sync covers one profile — the one whose database the page has open —
// plus the list of profiles itself, which every device keeps in step
// (profiles.js): a profile added on the iPad reaches the phone with the next
// sync there, a profile removed anywhere is dropped everywhere, and its rows
// on the server go with it.
//
// runSync() takes its dependencies (the supabase client, storage,
// practiceTracker) so it stays page-agnostic.
import { currentProfileId, listProfiles, mergeProfiles, scopedKey } from './profiles.js'

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
    // Stamps only. The blobs are fetched below for the scores that have to come
    // down or be merged, which is usually none: selecting '*' here meant
    // re-downloading the entire fingering corpus on every sync, and syncs are
    // no longer rare.
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
  if (!listProfiles().some((p) => p.id === profileId)) {
    // The profile this page is on was removed — on another device, as the
    // merge just learnt, or in another tab: its data is not to be pushed, on
    // this sync or any later one the page runs, and what the page holds goes
    // when it closes.
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

  // --- Fingerings ---
  const { fingeringsPushed, fingeringsPulled } = await syncFingerings({ supabase, storage, uid, profileId, remoteStamps: stampsRead.data })

  // --- Recompute aggregates locally if we pulled any sessions ---
  if (pulled > 0) {
    const meta = await fetchCatalogMeta()
    await practiceTracker.rebuildAggregates((scoreId) => meta[scoreId] ?? null)
  }

  setLastSync(new Date().toISOString(), profileId)
  return { pushed: toPush.length, pulled, fingeringsPushed, fingeringsPulled, profilesChanged }
}

// A score's fingerings travel as one record, and each side used to replace the
// other's whole, the newer winning. That lost notes whenever both had changed:
// an edit made on a stale copy — an iPad left open on the stand for days, its
// score page never pulling — went up with the stale copy and erased what the
// phone had added in the meantime. So a record keeps the version it last
// exchanged with the server (`synced`): whichever side changed since then is
// the one that moves, and when both did, the two are merged note by note.
async function syncFingerings({ supabase, storage, uid, profileId, remoteStamps }) {
  // A record from before stamps carries none: 0, the oldest there is.
  const localByUrl = new Map((await storage.getAllFingerings()).map((f) => [f.scoreUrl, { ...f, updatedAt: f.updatedAt || 0 }]))
  const moves = new Map([...localByUrl.keys()].map((url) => [url, 'push']))
  for (const r of remoteStamps) moves.set(r.score_url, fingeringMove(localByUrl.get(r.score_url), Number(r.updated_at)))
  const urlsFor = (...kinds) => [...moves].filter(([, move]) => kinds.includes(move)).map(([url]) => url)

  const outgoing = urlsFor('push').map((url) => localByUrl.get(url))
  const incoming = []
  let merged = 0
  for (const part of chunk(urlsFor('pull', 'merge'), CHUNK)) {
    const { data: rows, error } = await supabase
      .from('user_fingerings')
      .select('score_url, fingerings, updated_at')
      .eq('profile_id', profileId)
      .in('score_url', part)
    if (error) throw error
    for (const row of rows) {
      const remote = { scoreUrl: row.score_url, fingerings: row.fingerings, updatedAt: Number(row.updated_at) }
      const local = localByUrl.get(row.score_url)
      if (moves.get(row.score_url) !== 'merge') incoming.push(remote)
      else {
        const updatedAt = Math.max(Date.now(), local.updatedAt + 1, remote.updatedAt + 1)
        outgoing.push({ scoreUrl: row.score_url, fingerings: mergeFingerings(local, remote), updatedAt })
        merged++
      }
    }
  }

  if (outgoing.length) {
    const rows = outgoing.map((f) => ({ user_id: uid, profile_id: profileId, score_url: f.scoreUrl, fingerings: f.fingerings, updated_at: f.updatedAt }))
    const { error } = await supabase.from('user_fingerings').upsert(rows)
    if (error) throw error
  }

  // Each record is then kept as the version the server holds — once the server
  // does, or it would read as unchanged and never be sent. Written only over
  // the record as it was read: an edit made while the sync was out stays, for
  // the next sync to find both sides changed and merge them.
  const settled = [...outgoing, ...incoming, ...urlsFor('settle').map((url) => localByUrl.get(url))]
  await storage.putFingeringRecordsIfUnchanged(settled.map(({ scoreUrl, fingerings, updatedAt }) => ({
    record: { scoreUrl, fingerings, updatedAt, synced: { fingerings, updatedAt } },
    read: localByUrl.get(scoreUrl)?.updatedAt ?? 0,
  })))
  return { fingeringsPushed: outgoing.length, fingeringsPulled: incoming.length + merged }
}

// A record from before `synced` existed has only its stamp, and the newer side
// wins, as it always had; the exchange then gives it a `synced` ('settle' when
// the two already agree). A score only the server holds comes down.
function fingeringMove(record, remote) {
  if (!record) return 'pull'
  const base = record.synced?.updatedAt
  if (base === undefined) return record.updatedAt > remote ? 'push' : remote > record.updatedAt ? 'pull' : 'settle'
  const [mine, theirs] = [record.updatedAt !== base, remote !== base]
  return mine && theirs ? 'merge' : mine ? 'push' : theirs ? 'pull' : null
}

// Note by note, against the version both sides last had: a note one side left
// as it was takes the other's (a value, or its absence — a fingering cleared
// there stays cleared here), and a note both changed goes to the newer record.
export function mergeFingerings(local, remote) {
  const base = local.synced?.fingerings ?? {}
  const newer = local.updatedAt > remote.updatedAt ? local.fingerings : remote.fingerings
  const merged = {}
  for (const key of new Set([...Object.keys(local.fingerings), ...Object.keys(remote.fingerings)])) {
    const [mine, theirs, was] = [local.fingerings[key], remote.fingerings[key], base[key]]
    const value = mine === was ? theirs : theirs === was ? mine : newer[key]
    if (value !== undefined) merged[key] = value
  }
  return merged
}
