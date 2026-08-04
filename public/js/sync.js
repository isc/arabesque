// Cloud sync of training data (sessions + fingerings) for the signed-in user.
//
// Why it's conflict-free: you can't play two piano sessions at once, so sessions
// across devices are disjoint in time with unique ids — sync is a plain union by
// id. Fingerings are last-write-wins by updatedAt (the workflow always pulls
// before editing). Aggregates are never synced: they're recomputed locally from
// sessions after a pull.
//
// runSync() takes its dependencies (the supabase client, storage,
// practiceTracker) so it stays page-agnostic.
const SYNC_ENABLED_KEY = 'arabesque:sync-enabled'
const LAST_SYNC_KEY = 'arabesque:last-sync'
const CHUNK = 200

export function syncEnabled() {
  try {
    return localStorage.getItem(SYNC_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setSyncEnabled(on) {
  try {
    localStorage.setItem(SYNC_ENABLED_KEY, on ? '1' : '0')
  } catch {
    /* ignore: setting just won't persist */
  }
}

export function lastSyncAt() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch {
    return null
  }
}

function setLastSync(iso) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso)
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
export async function fetchCatalogMeta() {
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
    return map
  } catch {
    return {}
  }
}

// Pull missing sessions, push local-only sessions, reconcile fingerings, then
// recompute aggregates if anything was pulled. Returns a summary; throws on a
// hard error so the caller can surface it.
export async function runSync({ supabase, storage, practiceTracker }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const uid = user.id

  // --- Sessions (union by id) ---
  const { data: remoteIdRows, error: idErr } = await supabase.from('training_sessions').select('id')
  if (idErr) throw idErr
  const remoteIdList = remoteIdRows.map((r) => r.id)
  const remoteIds = new Set(remoteIdList)

  const localSessions = (await storage.getSessions()).filter((s) => s.endedAt && s.measures?.length)
  const localIds = new Set(localSessions.map((s) => s.id))

  const toPush = localSessions.filter((s) => !remoteIds.has(s.id))
  for (const part of chunk(toPush, CHUNK)) {
    const rows = part.map((s) => ({ user_id: uid, id: s.id, data: s, ended_at: s.endedAt }))
    const { error } = await supabase.from('training_sessions').upsert(rows)
    if (error) throw error
  }

  const missingIds = remoteIdList.filter((id) => !localIds.has(id))
  let pulled = 0
  for (const part of chunk(missingIds, CHUNK)) {
    const { data: rows, error } = await supabase.from('training_sessions').select('data').in('id', part)
    if (error) throw error
    for (const row of rows) {
      await storage.saveSession(row.data)
      pulled++
    }
  }

  // --- Fingerings (last-write-wins by updatedAt) ---
  const localFingerings = await storage.getAllFingerings()
  const { data: remoteFingerings, error: fErr } = await supabase.from('user_fingerings').select('*')
  if (fErr) throw fErr
  const remoteByUrl = new Map(remoteFingerings.map((r) => [r.score_url, r]))
  const localByUrl = new Map(localFingerings.map((f) => [f.scoreUrl, f]))

  const fingeringsToPush = localFingerings
    .filter((f) => {
      const r = remoteByUrl.get(f.scoreUrl)
      return !r || (f.updatedAt || 0) > Number(r.updated_at)
    })
    .map((f) => ({ user_id: uid, score_url: f.scoreUrl, fingerings: f.fingerings, updated_at: f.updatedAt || 0 }))
  if (fingeringsToPush.length) {
    const { error } = await supabase.from('user_fingerings').upsert(fingeringsToPush)
    if (error) throw error
  }

  let fingeringsPulled = 0
  for (const r of remoteFingerings) {
    const local = localByUrl.get(r.score_url)
    if (!local || Number(r.updated_at) > (local.updatedAt || 0)) {
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

  setLastSync(new Date().toISOString())
  return { pushed: toPush.length, pulled, fingeringsPushed: fingeringsToPush.length, fingeringsPulled }
}
