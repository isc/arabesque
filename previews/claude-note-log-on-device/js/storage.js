import { scopedKey, listProfiles, pruneRemovedProfileKeys, SCOPE_SEPARATOR } from './profiles.js'

// Each profile has a database of its own, named from this (profiles.js). The
// main profile's is the bare name — the one this device had before profiles.
const DB_BASE_NAME = 'arabesque'
// The name the database carried before the app was renamed. Its contents are
// moved over on first open (see readLegacyDatabase) so nobody has to re-import
// a backup.
const LEGACY_DB_NAME = 'piano-trainer'
export const DB_VERSION = 5
const FINGERINGS_STORE = 'fingerings'
const SESSIONS_STORE = 'sessions'
const AGGREGATES_STORE = 'aggregates'
const NOTE_LOGS_STORE = 'noteLogs'
const KEPT_NOTE_LOGS_STORE = 'keptNoteLogs'

// The kinds of data a profile keeps, a store each: how its records are keyed,
// what they are looked up by, and how a backup carries them, under the store's
// own name. Whatever goes over every store — creating them, moving the
// pre-rename database, exporting a backup — reads this list, so a store added
// here is in all of them, once DB_VERSION is raised: the upgrade is what
// creates it where the database already exists. storage.test.js holds a
// backup to restoring every store it carries, which is what makes sync.js's
// importBackup learn a new one. Backups made outside the app write the same
// keys: landing-video/capture/fetch-backup.mjs and scripts/demo/seed.js.
const STORE_DEFS = [
  // Without `synced` in a backup: it is this device's own exchange with the
  // server, as meaningless to another device as its last-sync time.
  { name: FINGERINGS_STORE, keyPath: 'scoreUrl', toBackup: ({ synced, ...record }) => record },
  { name: SESSIONS_STORE, keyPath: 'id', indexes: ['scoreId', 'startedAt'] },
  // Derived from the sessions, and rebuilt from them on import: a backup's
  // copy only lends its names (sync.js).
  { name: AGGREGATES_STORE, keyPath: 'scoreId' },
  // Every key played, a segment of a session's at a time (noteLog.js), until
  // the server has it. Kept out of a backup: it is raw material for the
  // analysis, megabytes of it, where a backup is the practice history — and
  // this store only holds what is not on the server yet, the last weeks at
  // most.
  { name: NOTE_LOGS_STORE, keyPath: 'id', backup: false },
  // Segments the server has, kept here for the analysis of the score they
  // were played on (noteLogAnalysis.js): moved over once pushed, or fetched
  // from the server for the sessions another device played. Out of a backup
  // for the same reason, and only a score's last sessions' (keepScoreNoteLogs
  // in noteLog.js).
  { name: KEPT_NOTE_LOGS_STORE, keyPath: 'id', backup: false },
]
export const STORES = STORE_DEFS.map((def) => def.name)
const BACKUP_DEFS = STORE_DEFS.filter((def) => def.backup !== false)
// What an operation fails with when the connection under it is gone rather
// than the operation being wrong: InvalidStateError from transaction() on a
// connection the browser has closed ("The database connection is closing"),
// UnknownError from a request the loss cut off ("Connection to Indexed
// Database server lost"). See withDb.
const CONNECTION_LOST = new Set(['InvalidStateError', 'UnknownError'])

// The version a fingering record new to this device last exchanged with the
// server: none, and nothing in it. sync.js merges the server's copy against
// it, so what was entered here joins what other devices entered first rather
// than replacing it.
export const NEVER_SYNCED = Object.freeze({ fingerings: Object.freeze({}), updatedAt: -1 })

// A session's segments, by their ids — `<session id>:<n>` (noteLog.js): ';'
// sorts right after ':'. Read back in their order, which a string key does
// not keep past the ninth.
const sessionRange = (sessionId) => IDBKeyRange.bound(`${sessionId}:`, `${sessionId};`, false, true)
const segmentNumber = (id) => Number(id.slice(id.lastIndexOf(':') + 1))

// The records of `store` under `keys`, a key with none left out.
async function getMany(store, keys) {
  return (await Promise.all(keys.map((key) => promisifyRequest(store.get(key))))).filter(Boolean)
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function promisifyTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    // The failed request's error: transaction.error is only set by the abort
    // that follows this event, and withDb needs the name.
    transaction.onerror = (event) => reject(event.target.error)
  })
}

function putAllToStore(transaction, storeName, items) {
  if (!items || !Array.isArray(items)) return 0
  const store = transaction.objectStore(storeName)
  for (const item of items) {
    store.put(item)
  }
  return items.length
}

// Everything the pre-rename database holds, or null when there is nothing to
// move. indexedDB.databases() is the only way to ask whether a database exists
// without creating an empty one as a side effect — and creating one here would
// make every future first-time visitor pay for a database they never had.
// Browsers that can run this app at all (Web MIDI, or the iOS wrapper's
// WKWebView) support it; anywhere else we simply start fresh.
async function readLegacyDatabase() {
  if (!indexedDB.databases) return null
  const existing = await indexedDB.databases()
  if (!existing.some((entry) => entry.name === LEGACY_DB_NAME)) return null

  // No version passed: this opens the database as it stands, never upgrading it.
  const legacy = await promisifyRequest(indexedDB.open(LEGACY_DB_NAME))
  const names = STORES.filter((name) => legacy.objectStoreNames.contains(name))
  const data = {}
  if (names.length > 0) {
    const transaction = legacy.transaction(names, 'readonly')
    for (const name of names) {
      data[name] = await promisifyRequest(transaction.objectStore(name).getAll())
    }
  }
  legacy.close()
  return data
}

async function openDatabase(name) {
  // Only the main profile's database descends from the pre-rename one: a
  // second profile starts empty by definition.
  const legacy = name === DB_BASE_NAME ? await readLegacyDatabase() : null
  // Only a database we just created may be filled from the old one: if this
  // browser already has data under the new name, it is the newer of the two.
  let created = false

  const database = await new Promise((resolve, reject) => {
    const open = () => {
      const request = indexedDB.open(name, DB_VERSION)
      let abandoned = false

      request.onerror = () => {
        if (abandoned) globalThis.addEventListener('pageshow', open, { once: true })
        else reject(request.error)
      }
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        created ||= event.oldVersion === 0
        const database = event.target.result
        for (const { name, keyPath, indexes = [] } of STORE_DEFS) {
          if (database.objectStoreNames.contains(name)) continue
          const store = database.createObjectStore(name, { keyPath })
          for (const index of indexes) store.createIndex(index, index, { unique: false })
        }
        // A page left while its upgrade is still running can be frozen into the
        // back/forward cache with the upgrade half done, and Chrome keeps every
        // later open of the database waiting behind it — no blocked event, no
        // error, forever: the next page's score never drew. Leaving abandons the
        // upgrade instead, and the open waits for the page to come back from the
        // cache to start it again; a page that never comes back has nothing
        // waiting on it. Not a rejection: nothing on a page being left would
        // catch it, and it would land in the errors a feedback report carries.
        // (Optional: there is no page to leave where the unit tests run.)
        const upgrade = request.transaction
        const abandon = () => {
          try {
            upgrade.abort()
            abandoned = true
          } catch {
            /* Over already. An upgrade is finished a moment before its complete
               event is dispatched, and abort() throws in between ("The
               transaction has finished"): nothing but the throw can tell the page
               so, the complete event being the first sign it gets. */
          }
        }
        globalThis.addEventListener?.('pagehide', abandon)
        const settled = () => globalThis.removeEventListener?.('pagehide', abandon)
        upgrade.addEventListener('complete', settled)
        upgrade.addEventListener('abort', settled)
      }
    }
    open()
  })

  if (legacy) {
    if (created) {
      const transaction = database.transaction(STORES, 'readwrite')
      for (const [name, items] of Object.entries(legacy)) putAllToStore(transaction, name, items)
      await promisifyTransaction(transaction)
    }
    // Dropped only once its contents are safely committed under the new name.
    indexedDB.deleteDatabase(LEGACY_DB_NAME)
  }

  return database
}

// Drops the databases of profiles this device no longer lists — removed here,
// or removed elsewhere and learnt by sync — and the keys scoped to them. Done
// on the way in rather than at removal time: a profile removed while its own
// page is open cannot drop the database that page holds, and the next open
// can. Only ever another profile's database, never the one being opened: a
// page keeps its own even once a sync has learnt it was removed, and the next
// page, on another profile, drops it. Best effort, and nobody waits for it: a
// browser without indexedDB.databases() keeps the orphans, which cost nothing.
async function pruneProfileStorage() {
  pruneRemovedProfileKeys()
  if (!indexedDB.databases) return
  const known = new Set([scopedKey(DB_BASE_NAME), ...listProfiles().map((p) => scopedKey(DB_BASE_NAME, p.id))])
  for (const { name } of await indexedDB.databases()) {
    if (name?.startsWith(DB_BASE_NAME + SCOPE_SEPARATOR) && !known.has(name)) indexedDB.deleteDatabase(name)
  }
}

export function initStorage() {
  // The open, held as the promise rather than as its result, so that a caller
  // arriving while it is still in flight joins it instead of starting one of
  // its own — legacy migration and deleteDatabase included. They do arrive
  // together: the score page reads its fingerings while the practice tracker
  // starts up. Dropped if the open fails, so a later call may try again.
  let dbReady = null

  function ensureDb() {
    dbReady ??= openDatabase(scopedKey(DB_BASE_NAME))
      .then((db) => {
        pruneProfileStorage().catch(() => {})
        // Storage left best-effort is what a browser clears first when the
        // disk fills up, the whole origin at once: the journal of a player who
        // never signed in, the fingerings not synced yet. Asked at every open,
        // which costs nothing once granted; Chrome and Safari answer without a
        // prompt, from how the site is used, and Firefox asks once.
        globalThis.navigator?.storage?.persist?.().catch(() => {})
        return db
      })
      .catch((error) => {
        dbReady = null
        throw error
      })
    return dbReady
  }

  // A page keeps its connection for as long as it lives, and in the iOS app
  // that is days: the app is suspended and woken, never reloaded. WebKit does
  // not keep a connection that long — when iOS reclaims the process serving
  // IndexedDB, every connection is closed under the page, and each transaction
  // after that fails. Held for good, the dead connection failed every read
  // until the page was reloaded by hand: the library woke up with its practice
  // columns empty (feedback be332d4d). So an operation that fails on a lost
  // connection drops it and runs once more on a fresh one; concurrent failures
  // on the same connection share that one reopen.
  async function withDb(operation) {
    const ready = ensureDb()
    const db = await ready
    try {
      return await operation(db)
    } catch (error) {
      if (!CONNECTION_LOST.has(error?.name)) throw error
      if (dbReady === ready) {
        dbReady = null
        db.close()
      }
      return operation(await ensureDb())
    }
  }

  function withStore(storeName, mode, operation) {
    return withDb((db) => operation(db.transaction(storeName, mode).objectStore(storeName)))
  }

  function dbGet(storeName, key) {
    return withStore(storeName, 'readonly', (store) => promisifyRequest(store.get(key)))
  }

  // Every record, or with `index` those whose key there matches `query` (a
  // value or an IDBKeyRange).
  function dbGetAll(storeName, { index, query } = {}) {
    return withStore(storeName, 'readonly', (store) => promisifyRequest((index ? store.index(index) : store).getAll(query)))
  }

  // The records under `keys`, in one transaction; a key with none is left out.
  function dbGetMany(storeName, keys) {
    return withStore(storeName, 'readonly', (store) => getMany(store, keys))
  }

  // Both note log stores in one transaction — the segments still to send and
  // those kept — resolved once it has committed, with what `operation` did.
  function withNoteLogStores(mode, operation) {
    return withDb(async (db) => {
      const transaction = db.transaction([NOTE_LOGS_STORE, KEPT_NOTE_LOGS_STORE], mode)
      const done = promisifyTransaction(transaction)
      const result = await operation(transaction.objectStore(NOTE_LOGS_STORE), transaction.objectStore(KEPT_NOTE_LOGS_STORE))
      await done
      return result
    })
  }

  function dbPut(storeName, data) {
    return withStore(storeName, 'readwrite', (store) => promisifyRequest(store.put(data)))
  }

  return {
    init: ensureDb,

    // Fingerings methods
    //
    // A score with no record yet gets one that has never met the server
    // (NEVER_SYNCED). A record written before `synced` existed carries none,
    // and is left to its own rule (sync.js).
    async getFingerings(scoreUrl) {
      return (await dbGet(FINGERINGS_STORE, scoreUrl)) || { scoreUrl, fingerings: {}, synced: NEVER_SYNCED }
    },

    async setFingering(scoreUrl, noteKey, finger) {
      await this._updateFingerings(scoreUrl, (fingerings) => {
        fingerings[noteKey] = finger
      })
    },

    async removeFingering(scoreUrl, noteKey) {
      await this._updateFingerings(scoreUrl, (fingerings) => {
        delete fingerings[noteKey]
      })
    },

    async _updateFingerings(scoreUrl, updateFn) {
      const data = await this.getFingerings(scoreUrl)
      // Edited as a copy: a record a sync wrote back holds one map for both
      // its fingerings and `synced` (IndexedDB stores the two references as
      // one object), and an edit in place would move the version the next
      // sync merges against along with it.
      data.fingerings = { ...data.fingerings }
      updateFn(data.fingerings)
      data.updatedAt = Date.now()
      await dbPut(FINGERINGS_STORE, data)
    },

    async getAllFingerings() {
      return dbGetAll(FINGERINGS_STORE)
    },

    // Overwrite a whole fingerings record ({ scoreUrl, fingerings, updatedAt }).
    async putFingeringRecord(record) {
      await dbPut(FINGERINGS_STORE, record)
    },

    // Overwrite records, each only if the stored one still carries the stamp
    // it was read with (`read`, 0 for none), all read and written in one
    // transaction: a writer that read a record earlier — sync writing back what
    // it exchanged, the score page translating old keys — must not write over
    // a fingering entered since.
    putFingeringRecordsIfUnchanged(entries) {
      return withStore(FINGERINGS_STORE, 'readwrite', (store) =>
        Promise.all(entries.map(async ({ record, read }) => {
          const stored = await promisifyRequest(store.get(record.scoreUrl))
          if ((stored?.updatedAt ?? 0) === read) await promisifyRequest(store.put(record))
        })))
    },

    // Sessions methods
    async saveSession(session) {
      await dbPut(SESSIONS_STORE, session)
      return session
    },

    async getSession(id) {
      return (await dbGet(SESSIONS_STORE, id)) || null
    },

    getSessions(scoreId = null) {
      return dbGetAll(SESSIONS_STORE, scoreId ? { index: 'scoreId', query: scoreId } : {})
    },

    // Every session's id, and nothing else of it: the whole history reads as
    // megabytes, its keys as a few kilobytes.
    getSessionIds() {
      return withStore(SESSIONS_STORE, 'readonly', (store) => promisifyRequest(store.getAllKeys()))
    },

    // The sessions of `ids`; an id with none is left out.
    getSessionsById(ids) {
      return dbGetMany(SESSIONS_STORE, ids)
    },

    // The sessions started from `from` up to, not including, `to` (Dates).
    // `startedAt` is always an ISO string in UTC, so its index sorts by time.
    getSessionsStartedBetween(from, to) {
      return dbGetAll(SESSIONS_STORE, { index: 'startedAt', query: IDBKeyRange.bound(from.toISOString(), to.toISOString(), false, true) })
    },

    // Aggregates methods
    async saveAggregate(aggregate) {
      await dbPut(AGGREGATES_STORE, aggregate)
      return aggregate
    },

    async getAggregate(scoreId) {
      return (await dbGet(AGGREGATES_STORE, scoreId)) || null
    },

    // The rows of `scoreIds`; a score with none is left out.
    getAggregates(scoreIds) {
      return dbGetMany(AGGREGATES_STORE, scoreIds)
    },

    async getAllAggregates() {
      return (await dbGetAll(AGGREGATES_STORE)) || []
    },

    // Every store a backup carries, each under its own name (see STORE_DEFS).
    async exportBackup() {
      const backup = { exportDate: new Date().toISOString() }
      for (const { name, toBackup = (record) => record } of BACKUP_DEFS) {
        backup[name] = (await dbGetAll(name)).map(toBackup)
      }
      return backup
    },

    // Sessions from elsewhere — a backup's, a sync's pull — that this device
    // does not have yet, by id, in one transaction. Resolves to how many were
    // new.
    importSessions(sessions) {
      return withDb(async (db) => {
        const transaction = db.transaction([SESSIONS_STORE], 'readwrite')
        const here = new Set(await promisifyRequest(transaction.objectStore(SESSIONS_STORE).getAllKeys()))
        const imported = putAllToStore(transaction, SESSIONS_STORE, sessions.filter((s) => !here.has(s.id)))
        await promisifyTransaction(transaction)
        return imported
      })
    },

    // Note logs methods (noteLog.js): every segment in NOTE_LOGS_STORE is one
    // the server does not have yet, every one in KEPT_NOTE_LOGS_STORE one it
    // has.
    saveNoteLog(segment) {
      return dbPut(NOTE_LOGS_STORE, segment)
    },

    // Unless one is held under the same id already: fails with a
    // ConstraintError then.
    addNoteLog(segment) {
      return withStore(NOTE_LOGS_STORE, 'readwrite', (store) => promisifyRequest(store.add(segment)))
    },

    // The segments' ids, and nothing else of them: their sessions are in them.
    getNoteLogIds() {
      return withStore(NOTE_LOGS_STORE, 'readonly', (store) => promisifyRequest(store.getAllKeys()))
    },

    getNoteLogsById(ids) {
      return dbGetMany(NOTE_LOGS_STORE, ids)
    },

    // The server has them: from the segments to send to those kept, in one
    // transaction, so that none is ever in both or in neither.
    keepNoteLogs(ids) {
      return withNoteLogStores('readwrite', async (pending, kept) => {
        for (const segment of await getMany(pending, ids)) kept.put(segment)
        for (const id of ids) pending.delete(id)
      })
    },

    // Segments fetched from the server.
    saveKeptNoteLogs(segments) {
      return withNoteLogStores('readwrite', (pending, kept) => {
        for (const segment of segments) kept.put(segment)
      })
    },

    // The segments of each of these sessions, sent or not, in order: an array
    // per session, as noteLogAnalysis.js reads one.
    getNoteLogsOfSessions(sessionIds) {
      return withNoteLogStores('readonly', (pending, kept) => {
        const read = (store, id) => promisifyRequest(store.getAll(sessionRange(id)))
        return Promise.all(
          sessionIds.map(async (id) =>
            (await Promise.all([read(kept, id), read(pending, id)])).flat().sort((a, b) => segmentNumber(a.id) - segmentNumber(b.id)),
          ),
        )
      })
    },

    // The ids of every segment held, sent or not.
    getHeldNoteLogIds() {
      return withNoteLogStores('readonly', async (pending, kept) =>
        (await Promise.all([pending, kept].map((store) => promisifyRequest(store.getAllKeys())))).flat(),
      )
    },

    // The kept segments of these sessions: the server still has them.
    deleteKeptNoteLogsOfSessions(sessionIds) {
      return withNoteLogStores('readwrite', (pending, kept) => {
        for (const id of sessionIds) kept.delete(sessionRange(id))
      })
    },

    // The segments of the sessions started before `epochMs`, sent or not, by
    // their ids, which open on it (noteLog.js).
    deleteNoteLogsBefore(epochMs) {
      return withNoteLogStores('readwrite', (pending, kept) => {
        const before = IDBKeyRange.upperBound(String(epochMs), true)
        pending.delete(before)
        kept.delete(before)
      })
    },

    // Swap the whole aggregates store for `aggregates`, in one transaction.
    // Aggregates are derived from sessions, and a rebuild replaces them all:
    // nothing reads a store half cleared, half written.
    replaceAggregates(aggregates) {
      return withDb((db) => {
        const transaction = db.transaction([AGGREGATES_STORE], 'readwrite')
        transaction.objectStore(AGGREGATES_STORE).clear()
        putAllToStore(transaction, AGGREGATES_STORE, aggregates)
        return promisifyTransaction(transaction)
      })
    },
  }
}
