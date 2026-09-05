import { traced } from './perfTrace.js' // TEMP diagnostic

const DB_NAME = 'arabesque'
// The name the database carried before the app was renamed. Its contents are
// moved over on first open (see readLegacyDatabase) so nobody has to re-import
// a backup.
const LEGACY_DB_NAME = 'piano-trainer'
const DB_VERSION = 3
const FINGERINGS_STORE = 'fingerings'
const SESSIONS_STORE = 'sessions'
const AGGREGATES_STORE = 'aggregates'
const STORES = [FINGERINGS_STORE, SESSIONS_STORE, AGGREGATES_STORE]

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
    transaction.onerror = () => reject(transaction.error)
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

async function openDatabase() {
  const legacy = await readLegacyDatabase()
  // Only a database we just created may be filled from the old one: if this
  // browser already has data under the new name, it is the newer of the two.
  let created = false

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

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

export function initStorage() {
  let db = null

  async function ensureDb() {
    if (!db) {
      db = await openDatabase()
    }
    return db
  }

  async function dbGet(storeName, key) {
    await ensureDb()
    const store = db.transaction(storeName, 'readonly').objectStore(storeName)
    return promisifyRequest(store.get(key))
  }

  async function dbGetAll(storeName) {
    await ensureDb()
    const store = db.transaction(storeName, 'readonly').objectStore(storeName)
    return promisifyRequest(store.getAll())
  }

  async function dbPut(storeName, data) {
    await ensureDb()
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName)
    // TEMP: put() structure-clones the value synchronously on the main thread,
    // and the session object grows with every measure played. Wrapping put()
    // itself is what isolates that clone from the transaction's own latency.
    return promisifyRequest(traced(PUT_LABELS[storeName], () => store.put(data)))
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
      await ensureDb()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SESSIONS_STORE], 'readonly')
        const store = transaction.objectStore(SESSIONS_STORE)
        const sessions = []

        let request
        if (scoreId) {
          const index = store.index('scoreId')
          request = index.openCursor(IDBKeyRange.only(scoreId))
        } else {
          request = store.openCursor()
        }

        request.onsuccess = (event) => {
          const cursor = event.target.result
          if (cursor) {
            const session = cursor.value
            if (dateRange) {
              const sessionDate = new Date(session.startedAt)
              if (sessionDate >= dateRange.start && sessionDate <= dateRange.end) {
                sessions.push(session)
              }
            } else {
              sessions.push(session)
            }
            cursor.continue()
          } else {
            resolve(sessions)
          }
        }

        request.onerror = () => reject(new Error('Failed to get sessions'))
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

      await ensureDb()

      const stores = [SESSIONS_STORE, AGGREGATES_STORE, FINGERINGS_STORE]
      const transaction = db.transaction(stores, 'readwrite')

      const importCounts = {
        sessions: putAllToStore(transaction, SESSIONS_STORE, backupData.sessions),
        aggregates: putAllToStore(transaction, AGGREGATES_STORE, backupData.aggregates),
        fingerings: putAllToStore(transaction, FINGERINGS_STORE, backupData.fingerings),
      }

      await promisifyTransaction(transaction)

      return {
        success: true,
        importedSessions: importCounts.sessions,
        importedAggregates: importCounts.aggregates,
        importedFingerings: importCounts.fingerings,
      }
    },

    // Wipe only the aggregates store. Aggregates are derived from sessions, so
    // cloud sync rebuilds them from scratch after pulling new sessions.
    async clearAggregates() {
      await ensureDb()
      const transaction = db.transaction([AGGREGATES_STORE], 'readwrite')
      transaction.objectStore(AGGREGATES_STORE).clear()
      await promisifyTransaction(transaction)
    },
  }
}
