// Data page: local backup (export/import) + account (magic-link sign-in).
//
// This page is the home for everything data-related. Cloud sync of training
// data builds on the account section here (next step); for now it owns the
// export/import that used to live in the ⚙️ menu, plus passwordless sign-in.
import { initStorage } from './storage.js'
import { initPracticeTracker } from './practiceTracker.js'
import { syncEnabled, setSyncEnabled, lastSyncAt } from './sync.js'
import { initAutoSync, requestSync } from './autoSync.js'
import { t, locale } from './i18n.js'

// A sign-in waiting for its code, so the form survives the trip to the mail app
// (and the reload that trip can cause). Not a secret: the code itself never
// touches storage, and the address is already typed in the form.
const PENDING_SIGNIN_KEY = 'arabesque:pending-signin'

function rememberPendingSignIn(email) {
  try {
    localStorage.setItem(PENDING_SIGNIN_KEY, email)
  } catch {
    /* the form just won't survive a reload */
  }
}

function pendingSignIn() {
  try {
    return localStorage.getItem(PENDING_SIGNIN_KEY)
  } catch {
    return null
  }
}

function forgetPendingSignIn() {
  try {
    localStorage.removeItem(PENDING_SIGNIN_KEY)
  } catch {
    /* ignore */
  }
}

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
    authStatus: 'idle', // 'idle' | 'sending' | 'sent' | 'verifying' | 'error'
    authError: '',
    // The same email carries a link and a code. The code is the one that works
    // everywhere: inside the iOS app, whose WKWebView has its own storage and
    // never sees a link opened in Safari, and when the mail is read on another
    // device than the one being signed in.
    otp: '',
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
          if (session) forgetPendingSignIn()
        })
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
        this.otp = ''
        // Reading the code means leaving for the mail app, and coming back can
        // reload the page — on iOS the webview is reloaded routinely. Without
        // this, the code form would be gone and the code useless.
        rememberPendingSignIn(email)
      }
    },

    // Signing in with the code from the email, rather than its link. The link
    // hands the session to whichever browser opens it, which is the wrong one
    // when the app is a WKWebView (its storage is its own) or when the mail is
    // read on another device.
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
      } else {
        // onAuthStateChange sets this.user; clear the sign-in form's state.
        this.authStatus = 'idle'
        this.otp = ''
        this.authError = ''
        forgetPendingSignIn()
      }
    },

    async signOut() {
      await supabase?.auth.signOut()
      this.user = null
      this.authStatus = 'idle'
      this.email = ''
      this.otp = ''
      this.authError = ''
      forgetPendingSignIn()
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
