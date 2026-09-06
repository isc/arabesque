import { describe, it, expect, beforeEach, vi } from 'vitest'

const PROFILES_KEY = 'arabesque:profiles'
const MAIN = 'main'

// The Storage interface the module leans on: get/set/remove, and the
// length/key(i) walk removeProfile uses.
function installLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

describe('profiles', () => {
  let profiles

  beforeEach(async () => {
    installLocalStorage()
    // The module caches what it parsed for the life of a page; a test is a page.
    vi.resetModules()
    profiles = await import('../../public/js/profiles.js')
  })

  it('is the main profile alone until someone adds to it, without writing anything', () => {
    expect(profiles.listProfiles()).toEqual([{ id: MAIN, name: '', avatar: profiles.AVATARS[0] }])
    expect(profiles.currentProfileId()).toBe(MAIN)
    expect(profiles.syncsToCloud()).toBe(true)
    expect(localStorage.getItem(PROFILES_KEY)).toBeNull()
  })

  it('keeps the main profile on the bare storage names and gives the others their own', () => {
    expect(profiles.scopedKey('arabesque')).toBe('arabesque')
    expect(profiles.scopedKey('arabesque:pending-session', 'p-1')).toBe('arabesque:pending-session@p-1')
  })

  it('adds a profile after the main one and switches to it for the next page', () => {
    const charlie = profiles.addProfile({ name: ' Charlie ', avatar: '🐻' })
    expect(charlie).toMatchObject({ name: 'Charlie', avatar: '🐻' })
    expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN, charlie.id])

    profiles.switchProfile(charlie.id)
    expect(profiles.currentProfile()).toEqual(charlie)
    expect(profiles.scopedKey('arabesque')).toBe(`arabesque@${charlie.id}`)
    expect(profiles.syncsToCloud()).toBe(false)
  })

  it('offers each new profile an avatar nobody wears', () => {
    expect(profiles.freeAvatar()).toBe(profiles.AVATARS[1])
    profiles.addProfile({ name: 'Charlie', avatar: profiles.AVATARS[1] })
    expect(profiles.freeAvatar()).toBe(profiles.AVATARS[2])
  })

  it('only switches to a profile that exists', () => {
    profiles.switchProfile('p-nope')
    expect(profiles.currentProfileId()).toBe(MAIN)
  })

  it('falls back to the main profile when the stored current one is gone', async () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ current: 'p-gone', profiles: [{ id: MAIN, name: 'Ivan', avatar: '🎹' }] }))
    vi.resetModules()
    profiles = await import('../../public/js/profiles.js')
    expect(profiles.currentProfileId()).toBe(MAIN)
    expect(profiles.currentProfile().name).toBe('Ivan')
  })

  it('starts over from a stored value it cannot read', async () => {
    localStorage.setItem(PROFILES_KEY, '{not json')
    vi.resetModules()
    profiles = await import('../../public/js/profiles.js')
    expect(profiles.listProfiles()).toHaveLength(1)
    expect(profiles.currentProfileId()).toBe(MAIN)
  })

  it('renames the main profile like any other, trimming the name', () => {
    profiles.updateProfile(MAIN, { name: ' Ivan ', avatar: '🎈' })
    expect(profiles.currentProfile()).toEqual({ id: MAIN, name: 'Ivan', avatar: '🎈' })
  })

  it('removes a profile with the keys scoped to it, landing back on the main one', () => {
    const charlie = profiles.addProfile({ name: 'Charlie' })
    profiles.switchProfile(charlie.id)
    localStorage.setItem(profiles.scopedKey('arabesque:pending-session'), '{}')
    localStorage.setItem('arabesque:pending-session', 'main')

    profiles.removeProfile(charlie.id)

    expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
    expect(profiles.currentProfileId()).toBe(MAIN)
    expect(localStorage.getItem(`arabesque:pending-session@${charlie.id}`)).toBeNull()
    expect(localStorage.getItem('arabesque:pending-session')).toBe('main')
  })

  it('never removes the main profile', () => {
    expect(() => profiles.removeProfile(MAIN)).toThrow()
    expect(profiles.listProfiles()).toHaveLength(1)
  })
})
