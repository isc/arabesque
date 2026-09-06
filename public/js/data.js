// Data page: profiles, local backup (export/import) + account (passwordless
// sign-in, and deleting the account again).
//
// This page is the home for everything data-related: who the data belongs to
// on this device (profiles.js), the export/import that used to live in the ⚙️
// menu, and signing in by email — with the link or the code it carries, see
// supabaseClient.js. Signing in is what turns cloud sync on; this page is
// where that becomes true for the device — for its main profile, the only one
// that syncs.
import { initStorage, dropProfileStorage } from './storage.js'
import { initPracticeTracker } from './practiceTracker.js'
import { lastSyncAt } from './sync.js'
import { initAutoSync, requestSync } from './autoSync.js'
import { deleteCurrentUser } from './account.js'
import { t, locale } from './i18n.js'
import {
  AVATARS,
  MAIN_PROFILE_ID,
  listProfiles,
  currentProfileId,
  profileName,
  freeAvatar,
  addProfile,
  updateProfile,
  removeProfile,
  switchProfile,
} from './profiles.js'

// The file name of a backup carries the profile it came from — except the
// main profile's, which keeps the name it always had.
function backupSlug(profile) {
  if (profile.id === MAIN_PROFILE_ID) return ''
  const slug = profile.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug ? `${slug}-` : ''
}

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
    // --- Profiles ---
    profiles: listProfiles(),
    currentProfileId: currentProfileId(),
    mainProfileId: MAIN_PROFILE_ID,
    avatars: AVATARS,
    profileName,
    newProfile: { name: '', avatar: freeAvatar() },
    // The profile whose deletion is being confirmed, or null.
    deletingProfileId: null,
    deletingProfile: false,

    // Whether the current profile is the one the account holds (profiles.js,
    // syncsToCloud): the account card is only theirs.
    get profileSyncs() {
      return this.currentProfileId === this.mainProfileId
    },
    get currentProfile() {
      return this.profileById(this.currentProfileId)
    },
    get deletingProfileName() {
      return profileName(this.profileById(this.deletingProfileId))
    },
    profileById(id) {
      return this.profiles.find((p) => p.id === id)
    },
    activateProfile(id) {
      switchProfile(id)
      // Same page, other profile: every module read the profile at import
      // time, so the page starts over (profiles.js).
      window.location.reload()
    },
    patchProfile(id, patch) {
      updateProfile(id, patch)
      this.profiles = listProfiles()
    },
    createProfile() {
      if (!this.newProfile.name.trim()) return
      addProfile(this.newProfile)
      this.profiles = listProfiles()
      this.newProfile = { name: '', avatar: freeAvatar() }
    },
    // Not the main profile (profiles.js has the reason), and not the current
    // one: its database is open on this page, and IndexedDB will not drop a
    // database with a connection on it.
    canDeleteProfile(id) {
      return id !== this.mainProfileId && id !== this.currentProfileId
    },
    async deleteProfile(id) {
      if (this.deletingProfile || !this.canDeleteProfile(id)) return
      this.deletingProfile = true
      try {
        removeProfile(id)
        await dropProfileStorage(id)
      } finally {
        this.deletingProfileId = null
        this.deletingProfile = false
        this.profiles = listProfiles()
      }
    },

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

    // Deleting the account. Two-step on purpose: the second button is the one
    // that destroys, and it only exists once the warning is on screen.
    confirmingDelete: false,
    deleteStatus: 'idle', // 'idle' | 'deleting' | 'done' | 'error'
    deleteError: '',

    async init() {
      await storage.init()
      // Another profile's data is not the account's: no client, no sync, and
      // the account card says where the account lives instead.
      if (!this.profileSyncs) return
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
        // Opening this page is a natural moment to sync. syncNow() is a no-op
        // when signed out.
        this.syncNow()
      }
      this.authReady = true
    },

    // Only a session clears the pending sign-in, never its absence: being
    // signed out is the normal state while waiting for a code, and init() calls
    // this before reading it back.
    setSession(session) {
      this.user = session?.user ?? null
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
      // callback to record it. It also abandons any sign-in in flight — the
      // one case where losing the session should forget the pending address.
      this.setSession(null)
      setPendingSignIn(null)
      this.authStatus = 'idle'
      this.email = ''
      this.otp = ''
      this.authError = ''
    },

    // Deletes the account and everything synced under it (account.js), then
    // leaves the page in its signed-out state with a word about what happened —
    // the sign-in form comes back on its own, and would otherwise be the only
    // answer to a button labelled "delete my account".
    async deleteAccount() {
      if (this.deleteStatus === 'deleting') return
      this.deleteStatus = 'deleting'
      this.deleteError = ''
      try {
        await deleteCurrentUser(supabase)
        // signOut() inside deleteCurrentUser fires onAuthStateChange, but say
        // it here too: the account being gone is this page's own state, not
        // something to wait on a callback for.
        this.setSession(null)
        this.confirmingDelete = false
        this.deleteStatus = 'done'
      } catch (err) {
        console.error('Account deletion error:', err)
        this.deleteStatus = 'error'
        this.deleteError = err.message || String(err)
      }
    },

    async exportBackup() {
      try {
        const backupData = await storage.exportBackup()
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `arabesque-backup-${backupSlug(this.currentProfile)}${new Date().toISOString().split('T')[0]}.json`
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
