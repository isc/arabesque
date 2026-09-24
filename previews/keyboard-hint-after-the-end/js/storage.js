import { traced } from './perfTrace.js' // TEMP diagnostic
import { scopedKey, listProfiles, SCOPE_SEPARATOR } from './profiles.js'

// Each profile has a database of its own, named from this (profiles.js). The
// main profile's is the bare name — the one this device had before profiles.
const DB_BASE_NAME = 'arabesque'
// The name the database carried before the app was renamed. Its contents are
// moved over on first open (see readLegacyDatabase) so nobody has to re-import
// a backup.
const LEGACY_DB_NAME = 'piano-trainer'
const DB_VERSION = 3
const FINGERINGS_STORE = 'fingerings'
const SESSIONS_STORE = 'sessions'
const AGGREGATES_STORE = 'aggregates'
const STORES = [FINGERINGS_STORE, SESSIONS_STORE, AGGREGATES_STORE]
// What an operation fails with when the connection under it is gone rather
// than the operation being wrong: InvalidStateError from transaction() on a
// connection the browser has closed ("The database connection is closing"),
// UnknownError from a request the loss cut off ("Connection to Indexed
// Database server lost"). See withDb.
const CONNECTION_LOST = new Set(['InvalidStateError', 'UnknownError'])

// TEMP: built once so the probe costs no per-put string when it's disabled.
const PUT_LABELS = {
  [FINGERINGS_STORE]: 'IDB put fingerings',
  [SESSIONS_STORE]: 'IDB put sessions',
  [AGGREGATES_STORE]: 'IDB put aggregates',
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
    const request = indexedDB.open(name, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      created ||= event.oldVersion === 0
      const database = event.target.result

      // Create fingerings store if needed
      if (!database.objectStoreNames.contains(FINGERINGS_STORE)) {
        database.createObjectStore(FINGERINGS_STORE, { keyPath: 'scoreUrl' })
      }

      // Create sessions store if needed
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = database.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
        sessionsStore.createIndex('scoreId', 'scoreId', { unique: false })
        sessionsStore.createIndex('startedAt', 'startedAt', { unique: false })
      }

      // Create aggregates store if needed
      if (!database.objectStoreNames.contains(AGGREGATES_STORE)) {
        database.createObjectStore(AGGREGATES_STORE, { keyPath: 'scoreId' })
      }
    }
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
// or removed elsewhere and learnt by sync. Done on the way in rather than at
// removal time: a profile removed while its own page is open cannot drop the
// database that page holds, and the next open can. Only ever another
// profile's database, never the one being opened: the current profile is
// always listed. Best effort, and nobody waits for it: a browser without
// indexedDB.databases() keeps the orphans, which cost nothing.
async function pruneProfileStorage() {
  if (!indexedDB.databases) return
  const known = new Set(listProfiles().map((p) => scopedKey(DB_BASE_NAME, p.id)))
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

  function dbGetAll(storeName) {
    return withStore(storeName, 'readonly', (store) => promisifyRequest(store.getAll()))
  }

  function dbPut(storeName, data) {
    // TEMP: put() structure-clones the value synchronously on the main thread,
    // and the session object grows with every measure played. Wrapping put()
    // itself is what isolates that clone from the transaction's own latency.
    return withStore(storeName, 'readwrite', (store) =>
      promisifyRequest(traced(PUT_LABELS[storeName], () => store.put(data))))
  }

  return {
    init: ensureDb,

    // Fingerings methods
    async getFingerings(scoreUrl) {
      return (await dbGet(FINGERINGS_STORE, scoreUrl)) || { scoreUrl, fingerings: {} }
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
      updateFn(data.fingerings)
      data.updatedAt = Date.now()
      await dbPut(FINGERINGS_STORE, data)
    },

    async getAllFingerings() {
      return dbGetAll(FINGERINGS_STORE)
    },

    // Overwrite a whole fingerings record ({ scoreUrl, fingerings, updatedAt }).
    // Used by cloud sync to apply a newer remote version (last-write-wins).
    async putFingeringRecord(record) {
      await dbPut(FINGERINGS_STORE, record)
    },

    // Sessions methods
    async saveSession(session) {
      await dbPut(SESSIONS_STORE, session)
      return session
    },

    async getSession(id) {
      return (await dbGet(SESSIONS_STORE, id)) || null
    },

    async getSessions(scoreId = null, dateRange = null) {
      const sessions = await withStore(SESSIONS_STORE, 'readonly', (store) =>
        promisifyRequest(scoreId ? store.index('scoreId').getAll(scoreId) : store.getAll()))
      if (!dateRange) return sessions
      return sessions.filter((session) => {
        const sessionDate = new Date(session.startedAt)
        return sessionDate >= dateRange.start && sessionDate <= dateRange.end
      })
    },

    // Aggregates methods
    async saveAggregate(aggregate) {
      await dbPut(AGGREGATES_STORE, aggregate)
      return aggregate
    },

    async getAggregate(scoreId) {
      return (await dbGet(AGGREGATES_STORE, scoreId)) || null
    },

    async getAllAggregates() {
      return (await dbGetAll(AGGREGATES_STORE)) || []
    },

    // Backup methods
    async exportBackup() {
      const sessions = await this.getSessions()
      const aggregates = await this.getAllAggregates()
      const fingerings = await this.getAllFingerings()

      return {
        exportDate: new Date().toISOString(),
        sessions,
        aggregates,
        fingerings,
      }
    },

    async importBackup(backupData) {
      if (!backupData || !backupData.sessions) {
        throw new Error('Invalid backup data format')
      }

      const importCounts = await withDb(async (db) => {
        const transaction = db.transaction([SESSIONS_STORE, AGGREGATES_STORE, FINGERINGS_STORE], 'readwrite')
        const counts = {
          sessions: putAllToStore(transaction, SESSIONS_STORE, backupData.sessions),
          aggregates: putAllToStore(transaction, AGGREGATES_STORE, backupData.aggregates),
          fingerings: putAllToStore(transaction, FINGERINGS_STORE, backupData.fingerings),
        }
        await promisifyTransaction(transaction)
        return counts
      })

      return {
        success: true,
        importedSessions: importCounts.sessions,
        importedAggregates: importCounts.aggregates,
        importedFingerings: importCounts.fingerings,
      }
    },

    // Wipe only the aggregates store. Aggregates are derived from sessions, so
    // cloud sync rebuilds them from scratch after pulling new sessions.
    clearAggregates() {
      return withDb((db) => {
        const transaction = db.transaction([AGGREGATES_STORE], 'readwrite')
        transaction.objectStore(AGGREGATES_STORE).clear()
        return promisifyTransaction(transaction)
      })
    },
  }
}
