// Deleting the account, from the data page.
//
// The delete itself is one RPC: the browser's publishable key cannot remove an
// auth user, so the privilege is lent by a security definer function that only
// ever deletes its own caller, and cascades to the synced tables — see
// supabase/account.sql for the whole reasoning.
//
// What stays behind: the practice history in this device's IndexedDB. Deleting
// the account is about the copy the server holds; wiping a local journal nobody
// asked us to touch would be the surprising half of the action. The data page
// says so, and offers the file export just above.

export async function deleteCurrentUser(supabase) {
  const { error } = await supabase.rpc('delete_current_user')
  if (error) throw error

  // The account is gone, but this browser still holds its now-orphaned session,
  // and that key is what every page reads to decide whether to sync at all
  // (signedInOnThisDevice, supabaseConfig.js). signOut() drops it — and already
  // treats the 401/404 a deleted user provokes as success.
  //
  // Its own failure is not worth reporting over a deletion that went through:
  // supabase-js clears the key by itself once a token refresh finally fails.
  await supabase.auth.signOut().catch(() => {})
}
