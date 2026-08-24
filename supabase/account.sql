-- Account deletion: the RPC behind "Supprimer mon compte" on the data page.
--
-- ⚠ Like the rest of this project, there is NO migration system — this DDL is
-- applied by hand on the Arabesque Supabase instance and this file is the
-- canonical record. Apply via the Management API SQL endpoint or:
--   psql "$SUPABASE_DB_URL" -f supabase/account.sql
--
-- Why this exists: App Review guideline 5.1.1(v) requires an app that creates
-- accounts to let you delete yours from inside the app. Signing out only stops
-- this device from syncing; it leaves the account and its rows in place.
--
-- Why an RPC rather than an Edge Function: removing an auth user needs
-- privileges the browser's publishable key will never have, and there are two
-- ways to lend them — a service-role Edge Function, or a security definer
-- function. The Edge Function would be this project's first: a deploy step and
-- a service-role key to hold, for what is one DELETE. A security definer
-- function keeps it inside the SQL that is already applied by hand.
--
-- Why deleting the auth user is enough: training_sessions and user_fingerings
-- both reference auth.users (id) ON DELETE CASCADE (supabase/sync.sql), so the
-- row that authorises the data and the data itself go together. Feedback rows
-- are deliberately NOT touched: they carry no user_id, are never readable by
-- the client, and can be sent without ever having an account.

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
-- Empty search_path: a security definer function must resolve every name
-- itself, so a caller cannot shadow one with a schema of their own. Every
-- reference below is schema-qualified for that reason.
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  -- Belt and braces: `authenticated` is the only role granted execute below,
  -- but that role is also what an expired-but-well-formed token resolves to.
  if uid is null then
    raise exception 'delete_current_user: no authenticated user'
      using errcode = '28000';
  end if;

  -- auth.uid() reads the caller's own JWT, so this can only ever delete the
  -- caller. Cascades through training_sessions and user_fingerings.
  delete from auth.users where id = uid;
end;
$$;

-- A security definer function is executable by PUBLIC unless told otherwise,
-- which would hand the anonymous role a function it must never reach.
revoke all on function public.delete_current_user() from public, anon;
grant execute on function public.delete_current_user() to authenticated;
