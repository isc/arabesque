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

// A page: the module reads the profile it is on when it loads.
async function openPage() {
  vi.resetModules()
  return import('../../public/js/profiles.js')
}

describe('profiles', () => {
  let profiles

  beforeEach(async () => {
    installLocalStorage()
    profiles = await openPage()
  })

  it('is the main profile alone until someone adds to it, without writing anything', () => {
    expect(profiles.listProfiles()).toEqual([{ id: MAIN, name: '', avatar: profiles.AVATARS[0], updatedAt: 0 }])
    expect(profiles.currentProfileId()).toBe(MAIN)
    expect(localStorage.getItem(PROFILES_KEY)).toBeNull()
  })

  it('keeps the main profile on the bare storage names and gives the others their own', () => {
    expect(profiles.scopedKey('arabesque')).toBe('arabesque')
    expect(profiles.scopedKey('arabesque:pending-session', 'p-1')).toBe('arabesque:pending-session@p-1')
  })

  it('adds a profile after the main one and switches to it for the next page', async () => {
    const charlie = profiles.addProfile({ name: ' Charlie ', avatar: '🐻' })
    expect(charlie).toMatchObject({ name: 'Charlie', avatar: '🐻' })
    expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN, charlie.id])

    profiles.switchProfile(charlie.id)
    profiles = await openPage()
    expect(profiles.currentProfile()).toEqual(charlie)
    expect(profiles.scopedKey('arabesque')).toBe(`arabesque@${charlie.id}`)
  })

  // The stored choice is the next page's. This one's database, keys and synced
  // rows are all named after the profile it opened on.
  it('keeps the page on the profile it opened on, whatever is stored since', async () => {
    const charlie = profiles.addProfile({ name: 'Charlie' })
    profiles.switchProfile(charlie.id)
    profiles = await openPage()

    profiles.mergeProfiles([{ id: charlie.id, name: '', avatar: '', updated_at: charlie.updatedAt + 1, deleted: true }])

    expect(profiles.currentProfileId()).toBe(charlie.id)
    expect(profiles.scopedKey('arabesque')).toBe(`arabesque@${charlie.id}`)
    expect((await openPage()).currentProfileId()).toBe(MAIN)
  })

  it('offers each new profile an avatar nobody wears', () => {
    expect(profiles.freeAvatar()).toBe(profiles.AVATARS[1])
    profiles.addProfile({ name: 'Charlie', avatar: profiles.AVATARS[1] })
    expect(profiles.freeAvatar()).toBe(profiles.AVATARS[2])
  })

  it('only switches to a profile that exists', async () => {
    profiles.switchProfile('p-nope')
    expect((await openPage()).currentProfileId()).toBe(MAIN)
  })

  it('falls back to the main profile when the stored current one is gone', async () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ current: 'p-gone', profiles: [{ id: MAIN, name: 'Ivan', avatar: '🎹' }] }))
    profiles = await openPage()
    expect(profiles.currentProfileId()).toBe(MAIN)
    expect(profiles.currentProfile().name).toBe('Ivan')
  })

  it('stamps a profile stored before stamps existed, so it can be sent', async () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ current: MAIN, profiles: [{ id: MAIN, name: 'Ivan', avatar: '🎹' }, { id: 'p-old', name: 'Charlie', avatar: '🐻' }] }))
    profiles = await openPage()
    const rows = profiles.mergeProfiles([]).toPush
    expect(rows.map((r) => r.updated_at)).toEqual([0, 0])
  })

  it('starts over from a stored value it cannot read', async () => {
    localStorage.setItem(PROFILES_KEY, '{not json')
    profiles = await openPage()
    expect(profiles.listProfiles()).toHaveLength(1)
    expect(profiles.currentProfileId()).toBe(MAIN)
  })

  it('renames the main profile like any other, trimming the name', () => {
    profiles.updateProfile(MAIN, { name: ' Ivan ', avatar: '🎈' })
    expect(profiles.currentProfile()).toMatchObject({ id: MAIN, name: 'Ivan', avatar: '🎈' })
  })

  it('removes a profile with the keys scoped to it, landing back on the main one', async () => {
    const charlie = profiles.addProfile({ name: 'Charlie' })
    profiles.switchProfile(charlie.id)
    localStorage.setItem(profiles.scopedKey('arabesque:pending-session', charlie.id), '{}')
    localStorage.setItem('arabesque:pending-session', 'main')

    profiles.removeProfile(charlie.id)

    expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
    expect(localStorage.getItem(`arabesque:pending-session@${charlie.id}`)).toBeNull()
    expect(localStorage.getItem('arabesque:pending-session')).toBe('main')
    expect((await openPage()).currentProfileId()).toBe(MAIN)
  })

  // Another tab can store a profile at any moment: a merge must start from
  // what is stored now, or writing it back drops that profile.
  it('merges into what another tab stored since, not into what it read before', () => {
    profiles.listProfiles()
    localStorage.setItem(PROFILES_KEY, JSON.stringify({
      current: MAIN,
      profiles: [{ id: MAIN, name: '', avatar: '🎹', updatedAt: 0 }, { id: 'p-tab', name: 'Léa', avatar: '🦊', updatedAt: 50 }],
      removed: [],
    }))

    profiles.mergeProfiles([{ id: 'p-phone', name: 'Tom', avatar: '🐻', updated_at: 60, deleted: false }])

    expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN, 'p-tab', 'p-phone'])
  })

  it('never removes the main profile', () => {
    expect(() => profiles.removeProfile(MAIN)).toThrow()
    expect(profiles.listProfiles()).toHaveLength(1)
  })

  describe('what sync exchanges', () => {
    it('offers the server every profile it lacks, a removed one as a tombstone', () => {
      const charlie = profiles.addProfile({ name: 'Charlie', avatar: '🐻' })
      let { toPush, changed } = profiles.mergeProfiles([])
      expect(changed).toBe(false)
      expect(toPush.map((r) => r.id)).toEqual([MAIN, charlie.id])
      expect(toPush[1]).toEqual({ id: charlie.id, name: 'Charlie', avatar: '🐻', updated_at: charlie.updatedAt, deleted: false })

      profiles.removeProfile(charlie.id)
      ;({ toPush } = profiles.mergeProfiles([{ id: charlie.id, name: 'Charlie', avatar: '🐻', updated_at: charlie.updatedAt, deleted: false }]))
      const tomb = toPush.find((r) => r.id === charlie.id)
      expect(tomb).toMatchObject({ deleted: true, name: '', avatar: '' })
      expect(tomb.updated_at).toBeGreaterThanOrEqual(charlie.updatedAt)
    })

    it('sends nothing the server already has as new', () => {
      const charlie = profiles.addProfile({ name: 'Charlie', avatar: '🐻' })
      const rows = profiles.mergeProfiles([]).toPush
      expect(profiles.mergeProfiles(rows).toPush).toEqual([])
      expect(profiles.listProfiles()[1].id).toBe(charlie.id)
    })

    it('adds a profile another device made', () => {
      const { changed, toPush } = profiles.mergeProfiles([{ id: 'p-phone', name: 'Léa', avatar: '🦊', updated_at: 100, deleted: false }])
      expect(changed).toBe(true)
      expect(toPush.map((r) => r.id)).toEqual([MAIN])
      expect(profiles.listProfiles().map((p) => p.name)).toEqual(['', 'Léa'])
    })

    it('lets the newer name win, whichever side has it', () => {
      const charlie = profiles.addProfile({ name: 'Charlie', avatar: '🐻' })
      profiles.mergeProfiles([{ id: charlie.id, name: 'Charly', avatar: '🐻', updated_at: charlie.updatedAt - 1, deleted: false }])
      expect(profiles.listProfiles()[1].name).toBe('Charlie')
      profiles.mergeProfiles([{ id: charlie.id, name: 'Charly', avatar: '🐻', updated_at: charlie.updatedAt + 1, deleted: false }])
      expect(profiles.listProfiles()[1].name).toBe('Charly')
    })

    it('drops a profile removed elsewhere, and does not take it back', () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      const tomb = { id: charlie.id, name: '', avatar: '', updated_at: charlie.updatedAt + 5, deleted: true }
      profiles.mergeProfiles([tomb])
      expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
      // The tombstone is now this device's too, and a stale live row loses to it.
      const { toPush } = profiles.mergeProfiles([{ ...tomb, deleted: false }])
      expect(toPush.find((r) => r.id === charlie.id)).toMatchObject({ deleted: true, updated_at: charlie.updatedAt + 5 })
    })

    // removeProfile sweeps them at once; a removal learnt from another device
    // leaves them for storage.js to sweep on its next open.
    it('forgets the keys of a profile removed on another device', () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      localStorage.setItem(`arabesque:last-sync@${charlie.id}`, 'x')
      profiles.mergeProfiles([{ id: charlie.id, name: '', avatar: '', updated_at: charlie.updatedAt + 1, deleted: true }])

      profiles.pruneRemovedProfileKeys()

      expect(localStorage.getItem(`arabesque:last-sync@${charlie.id}`)).toBeNull()
    })

    it('keeps a local removal over a server row with the same stamp', () => {
      const charlie = profiles.addProfile({ name: 'Charlie' })
      profiles.removeProfile(charlie.id)
      const stamp = profiles.mergeProfiles([]).toPush.find((r) => r.id === charlie.id).updated_at
      const { changed } = profiles.mergeProfiles([{ id: charlie.id, name: 'Charlie', avatar: '🎹', updated_at: stamp, deleted: false }])
      expect(changed).toBe(false)
      expect(profiles.listProfiles().map((p) => p.id)).toEqual([MAIN])
    })
  })
})
