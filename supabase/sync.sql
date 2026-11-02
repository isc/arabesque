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
--   - deleted_sessions: the sessions a player took back from their history, by
--     id, for good. Without it a union by id has no way to lose a row: any
--     device still holding the session would push it back. A plain union by id
--     too, and the only thing kept of the session.
--   - session_notes: every key played in a session, a segment per row
--     (public/js/noteLog.js has the format). Pushed once the session is on the
--     server, never pulled: it is read by the analysis, not by another device.
--   - user_fingerings: one row per (user, profile, score), stamped with
--     updated_at (a JS epoch-ms value). A device sends or takes a row whole,
--     and when both it and the server changed one since they last met, it
--     merges the two note by note before sending (public/js/sync.js).
--   - user_circles: the notes a player circled on a score, each with the few
--     words of a reminder; rows like user_fingerings', synced the same way. A
--     table of its own rather than a column there: public/js/storage.js says
--     why.
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
-- Auth: Supabase Auth (email one-time code, see auth.md). RLS restricts every row to its owner
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

create table if not exists public.deleted_sessions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id text not null default 'main',
  id         text not null,          -- the session's id, its rows gone (below)
  deleted_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.deleted_sessions enable row level security;
drop policy if exists deleted_sessions_owner on public.deleted_sessions;
create policy deleted_sessions_owner on public.deleted_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.session_notes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id text not null default 'main',
  id         text not null,          -- `<session id>:<segment number>`
  session_id text not null,
  started_at timestamptz,            -- the segment's first event
  -- The segment's columns (noteLog.js). json rather than jsonb: nothing on
  -- the server looks inside, and jsonb stores a small integer at about twice
  -- the size of its text.
  data       json not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists session_notes_user_profile_session
  on public.session_notes (user_id, profile_id, session_id);

alter table public.session_notes enable row level security;
drop policy if exists session_notes_owner on public.session_notes;
create policy session_notes_owner on public.session_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.user_fingerings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id text not null default 'main',
  score_url  text not null,
  fingerings jsonb not null,
  updated_at bigint not null,        -- client updatedAt (epoch ms): which side changed (sync.js)
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

create table if not exists public.user_circles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id text not null default 'main',
  score_url  text not null,
  circles    jsonb not null,         -- { <fingering key>: <reminder text, '' for none> }
  updated_at bigint not null,        -- client updatedAt (epoch ms): which side changed (sync.js)
  primary key (user_id, profile_id, score_url)
);

alter table public.user_circles enable row level security;
drop policy if exists user_circles_owner on public.user_circles;
create policy user_circles_owner on public.user_circles
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
  delete from public.session_notes where user_id = new.user_id and profile_id = new.id;
  delete from public.deleted_sessions where user_id = new.user_id and profile_id = new.id;
  delete from public.user_fingerings where user_id = new.user_id and profile_id = new.id;
  delete from public.user_circles where user_id = new.user_id and profile_id = new.id;
  return new;
end;
$$;
drop trigger if exists profiles_drop_rows on public.profiles;
create trigger profiles_drop_rows
  after insert or update of deleted on public.profiles
  for each row when (new.deleted)
  execute function public.drop_profile_rows();

-- A deleted session has no data either: its tombstone takes its rows with it,
-- for the same reason.
create or replace function public.drop_deleted_session_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.training_sessions where user_id = new.user_id and id = new.id;
  delete from public.session_notes where user_id = new.user_id and session_id = new.id;
  return new;
end;
$$;
drop trigger if exists deleted_sessions_drop_rows on public.deleted_sessions;
create trigger deleted_sessions_drop_rows
  after insert on public.deleted_sessions
  for each row
  execute function public.drop_deleted_session_rows();

-- And a device that has not heard yet cannot bring them back: a build from
-- before tombstones, or a sync already under way, pushes what it holds of the
-- session, and the row is dropped without a word. A row's id is read off the
-- column itself: to_jsonb(new) would serialise a whole segment of notes at
-- every insert.
create or replace function public.skip_deleted_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id text;
begin
  if tg_table_name = 'session_notes' then
    session_id := new.session_id;
  else
    session_id := new.id;
  end if;
  if exists (select 1 from public.deleted_sessions where user_id = new.user_id and id = session_id) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists training_sessions_skip_deleted on public.training_sessions;
create trigger training_sessions_skip_deleted
  before insert on public.training_sessions
  for each row
  execute function public.skip_deleted_session();
drop trigger if exists session_notes_skip_deleted on public.session_notes;
create trigger session_notes_skip_deleted
  before insert on public.session_notes
  for each row
  execute function public.skip_deleted_session();
