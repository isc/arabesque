-- Cloud sync of training data: per-user tables + RLS.
--
-- ⚠ Like the rest of this project, there is NO migration system — this DDL is
-- applied by hand on the piano-trainer Supabase instance and this file is the
-- canonical record. Apply via the Management API SQL endpoint or:
--   psql "$SUPABASE_DB_URL" -f supabase/sync.sql
-- Every statement is idempotent, so the whole file can be re-applied.
--
-- Model (see why it's conflict-free in the PR): you can't play two piano
-- sessions at once, so sessions across devices are disjoint in time with unique
-- ids — sync is a plain union by id, no conflict resolution needed.
--   - training_sessions: one row per finished session, append-only. Sessions are
--     immutable once ended; sync pushes ids the server lacks and pulls ids the
--     client lacks. Aggregates are NOT stored here — they are recomputed locally
--     from sessions after a pull.
--   - user_fingerings: one row per (user, profile, score); last-write-wins on
--     updated_at (a JS epoch-ms value), which is safe because the workflow
--     always pulls before editing.
--   - profiles: the people sharing the account's devices (public/js/profiles.js).
--     One row per (user, profile); the newest updated_at wins, and a removed
--     profile keeps its row as a tombstone (deleted) so that a device that
--     still lists it drops it rather than pushing it back. The main profile
--     has the id 'main' on every device.
--
-- Every data row carries the profile it belongs to (profile_id, 'main' for
-- rows from before profiles existed). A device syncs one profile at a time —
-- the one whose database it has open — and filters on that column.
--
-- Auth: Supabase Auth (email magic link). RLS restricts every row to its owner
-- via auth.uid(); the publishable key alone grants nothing without a session.

create table if not exists public.training_sessions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,          -- client-generated session id (immutable)
  data       jsonb not null,         -- the full session record
  ended_at   timestamptz,            -- session.endedAt, for ordering/debug
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.training_sessions
  add column if not exists profile_id text not null default 'main';
-- One index serves the profile-scoped reads the client makes and any range
-- on ended_at; the pre-profile (user_id, ended_at) one is folded into it.
drop index if exists public.training_sessions_user_ended;
create index if not exists training_sessions_user_profile_ended
  on public.training_sessions (user_id, profile_id, ended_at);

alter table public.training_sessions enable row level security;
drop policy if exists training_sessions_owner on public.training_sessions;
create policy training_sessions_owner on public.training_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.user_fingerings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id text not null default 'main',
  score_url  text not null,
  fingerings jsonb not null,
  updated_at bigint not null,        -- client updatedAt (epoch ms) for last-write-wins
  primary key (user_id, profile_id, score_url)
);
-- The table predates profiles: its key is widened to the profile.
alter table public.user_fingerings
  add column if not exists profile_id text not null default 'main';
alter table public.user_fingerings drop constraint if exists user_fingerings_pkey;
alter table public.user_fingerings add primary key (user_id, profile_id, score_url);

alter table public.user_fingerings enable row level security;
drop policy if exists user_fingerings_owner on public.user_fingerings;
create policy user_fingerings_owner on public.user_fingerings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.profiles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,          -- client-generated, 'main' for the first
  name       text not null default '',
  avatar     text not null default '',
  updated_at bigint not null,        -- client epoch ms, last-write-wins
  deleted    boolean not null default false,  -- a tombstone: the profile is gone
  primary key (user_id, id)
);

alter table public.profiles enable row level security;
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A removed profile has no data: the tombstone takes its rows with it, here
-- rather than in the client, so it holds for every client and every partial
-- sync. Not a foreign-key cascade, since the tombstone row itself must stay.
create or replace function public.drop_profile_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.training_sessions where user_id = new.user_id and profile_id = new.id;
  delete from public.user_fingerings where user_id = new.user_id and profile_id = new.id;
  return new;
end;
$$;
drop trigger if exists profiles_drop_rows on public.profiles;
create trigger profiles_drop_rows
  after insert or update of deleted on public.profiles
  for each row when (new.deleted)
  execute function public.drop_profile_rows();
