import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AUTH_STORAGE_KEY } from '../../public/js/supabaseConfig.js'
import { defaultFeedbackEmail, submitFeedback } from '../../public/js/feedback.js'

// What the feedback form's e-mail field starts from: the address the account
// signed in with, unless a report was sent from a field the player had changed
// or emptied. The rules worth pinning are the escape hatches — a cleared field
// stays cleared, the account address stays the one that can change — and that
// nothing here can break a browser that refuses storage.

const REMEMBERED_KEY = 'arabesque:feedback-email'

// The suite runs in node; these modules only ever touch localStorage.
function installStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

// Signed in, as far as a page can tell without loading @supabase/supabase-js:
// the session the client persists, with the user nested in it.
const signIn = (email) =>
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'x', user: { email } }))

// Sending is what remembers, so the tests go through it rather than through a
// setter of their own. The row itself is Supabase's business (submitFeedback
// only needs an answer), so the POST is answered here.
const send = (email, { ok = true } = {}) => {
  vi.stubGlobal('fetch', async () => ({ ok, status: ok ? 201 : 500, text: async () => 'nope' }))
  return submitFeedback({ message: 'Bonjour', email, category: '', context: {} })
}

describe('feedback e-mail default', () => {
  beforeEach(() => installStorage())

  it('is empty for a player with no account and nothing sent', () => {
    expect(defaultFeedbackEmail()).toBe('')
  })

  it('is the address entered for data sync', () => {
    signIn('player@example.com')
    expect(defaultFeedbackEmail()).toBe('player@example.com')
  })

  it('shrugs off a session it cannot read', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, 'not json')
    expect(defaultFeedbackEmail()).toBe('')
  })

  it('is the address a report was sent with, trimmed', async () => {
    await send('  typed@example.com  ')
    expect(defaultFeedbackEmail()).toBe('typed@example.com')
  })

  it('prefers the address sent over the one the account carries', async () => {
    signIn('account@example.com')
    await send('other@example.com')
    expect(defaultFeedbackEmail()).toBe('other@example.com')
  })

  it('stays empty once a report was sent with the field cleared', async () => {
    signIn('account@example.com')
    await send('')
    expect(defaultFeedbackEmail()).toBe('')
  })

  it('follows the account when that is what was sent, so a new address wins', async () => {
    signIn('account@example.com')
    await send('account@example.com')
    // Nothing of its own stored: the account is still the one being read.
    expect(localStorage.getItem(REMEMBERED_KEY)).toBe(null)
    signIn('moved@example.com')
    expect(defaultFeedbackEmail()).toBe('moved@example.com')
  })

  it('remembers nothing from a report that failed to leave', async () => {
    await expect(send('typed@example.com', { ok: false })).rejects.toThrow()
    expect(defaultFeedbackEmail()).toBe('')
  })

  it('falls back to the account address when the memory cannot be read', async () => {
    signIn('player@example.com')
    const store = globalThis.localStorage
    globalThis.localStorage = {
      ...store,
      getItem: (k) => {
        if (k === REMEMBERED_KEY) throw new Error('storage disabled')
        return store.getItem(k)
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
      removeItem: () => {
        throw new Error('storage disabled')
      },
    }
    await expect(send('other@example.com')).resolves.not.toThrow()
    expect(defaultFeedbackEmail()).toBe('player@example.com')
  })
})
