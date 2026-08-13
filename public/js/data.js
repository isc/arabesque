// Data page: local backup (export/import) + account (passwordless sign-in).
//
// This page is the home for everything data-related: the export/import that
// used to live in the ⚙️ menu, signing in by email — with the link or the code
// it carries, see supabaseClient.js — and the switch that drives cloud sync.
import { initStorage } from './storage.js'
import { initPracticeTracker } from './practiceTracker.js'
import { setSyncSignedIn, lastSyncAt } from './sync.js'
import { initAutoSync, requestSync } from './autoSync.js'
import { t, locale } from './i18n.js'

export function dataApp() {
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)
  // Loaded lazily in init() so export/import work without waiting on (or even
  // reaching) the @supabase/supabase-js CDN module.
  let supabase = null
  let authRedirectUrl = null
  let pendingSignIn = () => null
  let setPendingSignIn = () => {}

  return {
    cloudConfigured: false,
    authReady: false,
    user: null, // the signed-in Supabase user, or null
    email: '',
    authStatus: 'idle', // 'idle' | 'sending' | 'sent' | 'verifying' | 'error'
    authError: '',
    authErrorLabel: '', // i18n key naming which step failed
    // The code from the sign-in email — the half of it that reaches us wherever
    // the mail is read (see supabaseClient.js for why a link cannot).
    otp: '',

    // Whether the email is out and we are waiting for its code. Written once
    // here rather than as a compound status test in three places of the markup.
    get codeSent() {
      return this.authStatus === 'sent' || this.authStatus === 'verifying'
    },
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
        pendingSignIn = mod.pendingSignIn
        setPendingSignIn = mod.setPendingSignIn
        this.cloudConfigured = !!supabase
      } catch (err) {
        console.error('Supabase client failed to load:', err)
        this.cloudConfigured = false
      }
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        this.setSession(data.session)
        // Keep the UI in sync with sign-in/out and the magic-link redirect.
        supabase.auth.onAuthStateChange((_event, session) => this.setSession(session))
        // Came back from the mail app (or reloaded): reopen the code form on
        // the address that was asked for, rather than starting over.
        const pending = pendingSignIn()
        if (!this.user && pending) {
          this.email = pending
          this.authStatus = 'sent'
        }
        // No syncOnOpen: this page opens with syncNow() just below, which
        // reports the outcome instead of syncing silently. The callback keeps
        // "Last synced" honest for the syncs that do fire on their own.
        initAutoSync({ storage, practiceTracker }, {
          onSynced: () => { this.lastSync = lastSyncAt() },
        })
        // Opening this page is a natural moment to sync.
        if (this.user) this.syncNow()
      }
      this.authReady = true
    },

    // The one place that knows whether an account is signed in on this device.
    // Mirrored into storage so the score and library pages can decide whether
    // to sync without loading the Supabase client to ask (see sync.js).
    setSession(session) {
      this.user = session?.user ?? null
      setSyncSignedIn(!!session)
      if (session) setPendingSignIn(null)
    },

    async syncNow() {
      if (!supabase || !this.user || this.syncStatus === 'syncing') return
      this.syncStatus = 'syncing'
      this.syncError = ''
      this.syncSummary = ''
      try {
        // Through requestSync so a sync started elsewhere (this page also gets
        // the tab-back trigger) isn't run twice over. It returns null if the
        // session expired out from under this.user — nothing synced, nothing
        // to report.
        const r = await requestSync()
        if (!r) {
          this.syncStatus = 'idle'
          return
        }
        // this.lastSync is set by the onSynced callback above.
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

    // Asks for the sign-in email, which carries both a link and a code.
    async requestSignInEmail() {
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
        this.authErrorLabel = 'data.authError'
      } else {
        this.authStatus = 'sent'
        setPendingSignIn(email)
      }
    },

    // Signing in with the code rather than the link (see supabaseClient.js).
    async verifyOtp() {
      const token = this.otp.replace(/\s/g, '')
      if (!token || this.authStatus === 'verifying') return
      this.authStatus = 'verifying'
      this.authError = ''
      const { error } = await supabase.auth.verifyOtp({
        email: this.email.trim(),
        token,
        type: 'email',
      })
      if (error) {
        // Back to 'sent': the form stays open so a mistyped code can be redone
        // without asking for another email.
        this.authStatus = 'sent'
        this.authError = error.message
        this.authErrorLabel = 'data.otpError'
      } else {
        // onAuthStateChange sets this.user; clear the sign-in form's state.
        this.authStatus = 'idle'
        this.otp = ''
        // Signing in here doesn't reload the page, so nothing else would pull
        // what this account already has — the whole point of signing in.
        this.syncNow()
      }
    },

    async signOut() {
      await supabase?.auth.signOut()
      // Signing out is what turns syncing off, so don't wait on the auth
      // callback to record it.
      this.setSession(null)
      this.authStatus = 'idle'
      this.email = ''
      this.otp = ''
      this.authError = ''
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
