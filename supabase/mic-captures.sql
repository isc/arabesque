-- Mic-mode captures: a private Storage bucket the capture page uploads into.
--
-- public/dev/mic-capture.html records, on one clock, a microphone take of a
-- piano that also sends MIDI — the sound mic mode works from, and the notes it
-- should have found. scripts/mic-captures.mjs fetches them and replays the
-- sound through the detector. Same shape as the feedback table
-- (feedback.sql): the browser can write and nothing else; reading back goes
-- through the Management API's keys, outside the app.
--
-- ⚠ No migration system: applied by hand (this file through the Management
-- API's database/query, or psql), and this file is the canonical record.
-- Idempotent.
--
-- Signed-in players only, each into a folder named after their own id, so
-- the anonymous key ships no way to fill the bucket. 50 MB is a little under
-- five minutes of 48 kHz 16-bit mono.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mic-captures', 'mic-captures', false, 52428800, array['audio/wav'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mic captures: players upload into their own folder" on storage.objects;
create policy "mic captures: players upload into their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mic-captures' and (storage.foldername(name))[1] = (select auth.uid()::text));
