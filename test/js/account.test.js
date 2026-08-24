import { describe, it, expect } from 'vitest'
import { deleteCurrentUser } from '../../public/js/account.js'

// Minimal fake of the Supabase client covering exactly what deleteCurrentUser
// touches: rpc() and auth.signOut().
function makeFakeSupabase({ rpcError = null, signOutThrows = false } = {}) {
  const calls = { rpc: [], signOut: 0 }
  return {
    calls,
    async rpc(name, params) {
      calls.rpc.push([name, params])
      return { data: null, error: rpcError }
    },
    auth: {
      async signOut() {
        calls.signOut++
        if (signOutThrows) throw new Error('network down')
        return { error: null }
      },
    },
  }
}

describe('deleteCurrentUser', () => {
  it('calls the delete_current_user RPC, then signs the device out', async () => {
    const supabase = makeFakeSupabase()

    await deleteCurrentUser(supabase)

    expect(supabase.calls.rpc).toEqual([['delete_current_user', undefined]])
    expect(supabase.calls.signOut).toBe(1)
  })

  it('throws and leaves the session alone when the RPC fails', async () => {
    // Signing out on a failed delete would strand the account: signed out of an
    // account that still exists, with no way back to the button from here.
    const supabase = makeFakeSupabase({ rpcError: new Error('permission denied') })

    await expect(deleteCurrentUser(supabase)).rejects.toThrow('permission denied')
    expect(supabase.calls.signOut).toBe(0)
  })

  it('still reports success when signing out fails', async () => {
    // The account is already gone at that point, so surfacing the sign-out
    // error would say the deletion failed when it did not.
    const supabase = makeFakeSupabase({ signOutThrows: true })

    await expect(deleteCurrentUser(supabase)).resolves.toBeUndefined()
    expect(supabase.calls.signOut).toBe(1)
  })
})
