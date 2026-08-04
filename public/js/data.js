// Data page: local backup (export/import) + account (magic-link sign-in).
//
// This page is the home for everything data-related. Cloud sync of training
// data builds on the account section here (next step); for now it owns the
// export/import that used to live in the ⚙️ menu, plus passwordless sign-in.
import { initStorage } from './storage.js'
import { initPracticeTracker } from './practiceTracker.js'
import { runSync, syncEnabled, setSyncEnabled, lastSyncAt } from './sync.js'
import { t, locale } from './i18n.js'

export function dataApp() {
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)
  // Loaded lazily in init() so export/import work without waiting on (or even
  // reaching) the @supabase/supabase-js CDN module.
  let supabase = null
  let authRedirectUrl = null

  return {
    cloudConfigured: false,
    authReady: false,
    user: null, // the signed-in Supabase user, or null
    email: '',
    authStatus: 'idle', // 'idle' | 'sending' | 'sent' | 'error'
    authError: '',
    autoSync: syncEnabled(),
    lastSync: lastSyncAt(),
    syncStatus: 'idle', // 'idle' | 'syncing' | 'done' | 'error'
    syncError: '',
    syncSummary: '',

    async init() {
      await storage.init()
      try {
        const mod = await import('./supabaseClient.js')
        supabase = mod.supabase
        authRedirectUrl = mod.authRedirectUrl
        this.cloudConfigured = !!supabase
      } catch (err) {
        console.error('Supabase client failed to load:', err)
        this.cloudConfigured = false
      }
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        this.user = data.session?.user ?? null
        // Keep the UI in sync with sign-in/out and the magic-link redirect.
        supabase.auth.onAuthStateChange((_event, session) => {
          this.user = session?.user ?? null
        })
        // Opening this page is a natural moment to sync, if it's enabled.
        if (this.user && this.autoSync) this.syncNow()
      }
      this.authReady = true
    },

    // x-model already flipped this.autoSync; persist it and sync if enabling.
    onAutoSyncChanged() {
      setSyncEnabled(this.autoSync)
      if (this.autoSync && this.user) this.syncNow()
    },

    async syncNow() {
      if (!supabase || !this.user || this.syncStatus === 'syncing') return
      this.syncStatus = 'syncing'
      this.syncError = ''
      this.syncSummary = ''
      try {
        const r = await runSync({ supabase, storage, practiceTracker })
        this.lastSync = lastSyncAt()
        this.syncSummary = t('data.syncSummary', {
          up: r.pushed + r.fingeringsPushed,
          down: r.pulled + r.fingeringsPulled,
        })
        this.syncStatus = 'done'
      } catch (err) {
        console.error('Sync error:', err)
        this.syncStatus = 'error'
        this.syncError = err.message || String(err)
      }
    },

    lastSyncLabel() {
      if (!this.lastSync) return t('data.syncNever')
      return new Date(this.lastSync).toLocaleString(locale())
    },

    async sendMagicLink() {
      const email = this.email.trim()
      if (!email || this.authStatus === 'sending') return
      this.authStatus = 'sending'
      this.authError = ''
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authRedirectUrl() },
      })
      if (error) {
        this.authStatus = 'error'
        this.authError = error.message
      } else {
        this.authStatus = 'sent'
      }
    },

    async signOut() {
      await supabase?.auth.signOut()
      this.user = null
      this.authStatus = 'idle'
      this.email = ''
    },

    async exportBackup() {
      try {
        const backupData = await storage.exportBackup()
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `arabesque-backup-${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        alert(t('library.exportOk'))
      } catch (error) {
        console.error('Export error:', error)
        alert(t('library.exportError', { error: error.message }))
      }
    },

    async importBackup(event) {
      const file = event.target.files[0]
      if (!file) return
      try {
        const backupData = JSON.parse(await file.text())
        const result = await storage.importBackup(backupData)
        if (result.success) {
          alert(
            t('library.importOk', {
              sessions: result.importedSessions,
              aggregates: result.importedAggregates,
              fingerings: result.importedFingerings,
            })
          )
        }
      } catch (error) {
        console.error('Import error:', error)
        alert(t('library.importError', { error: error.message }))
      }
      event.target.value = ''
    },
  }
}
