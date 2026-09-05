-- Piano Trainer user feedback: table, RLS and email notification.
--
-- ⚠ Like Tablito, this project has NO migration system. The DDL below is
-- applied by hand on the (piano-trainer-only) Supabase instance — this file is
-- the canonical record, executed by no build.
--
-- Architecture: the static GitHub Pages frontend POSTs feedback directly to
-- PostgREST (public/js/feedback.js) using the publishable key. RLS lets the
-- anonymous role INSERT — and nothing else. An AFTER INSERT trigger then fires
-- an *asynchronous* HTTP call (pg_net, doesn't block the insert) to the Resend
-- API, dropping each new feedback in the admin inbox. Zero Edge Function, zero
-- backend to deploy.
--
-- One-time setup (outside this repo):
--   1. Create a NEW Supabase project (dedicated to Piano Trainer), then paste
--      its URL + publishable key into public/js/feedback.js.
--   2. Resend account (free) + API key.
--   3. Store the key in Vault (never in clear text here):
--        select vault.create_secret('re_xxxxx', 'resend_api_key');
--      (rotation: select vault.update_secret(
--         (select id from vault.secrets where name='resend_api_key'), 're_yyyyy');)
--   4. To send from feedback@<your-domain>: verify the domain in Resend (DNS).
--      Until then, use 'onboarding@resend.dev' as `from` (delivers only to the
--      Resend account email) — see FROM_ADDR below.
--
-- Apply:
--   psql "$SUPABASE_DB_URL" -f supabase/feedback.sql
-- (idempotent: if not exists + create or replace + drop ... if exists)
--
-- Reading the feedback back (the anon role cannot: insert only) goes through
-- the Management API — see the header of scripts/feedback.mjs.
--
-- Debugging deliveries (pg_net logs responses):
--   select status_code, content from net._http_response order by created desc limit 5;

create extension if not exists pg_net with schema extensions;

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message    text not null,
  email      text,
  category   text,          -- 'bug' | 'idea' | 'score' | 'other' (free text; UI-constrained)
  context    jsonb,         -- app_version, locale, user_agent, viewport, anonymized stats
  screenshot text,          -- data URL of the score on screen, opt-out (see below)
  status     text not null default 'new'   -- constrained just below
);

-- A picture of what the reporter was looking at, as a data URL (WebP, or JPEG
-- where WebP is not available) produced in the browser by public/js/screenshot.js.
--
-- Why a column and not Supabase Storage: uploading from the browser would mean
-- a storage policy letting `anon` INSERT into storage.objects, which hands the
-- publishable key a brand-new power — arbitrary file upload into the project,
-- off-table and unbounded. It would also split one submission into two
-- unrelated requests, so a row can end up naming an object that never arrived.
-- A column keeps the existing security property exactly as it was: one table,
-- one insert-only policy, nothing else granted. The cost is storage — at ~80 kB
-- of base64 per report it is single-digit MB a year against the free tier's
-- 500 MB, and TOAST keeps the value out of the main heap so the listing query,
-- which never selects it, does not slow down.
alter table public.feedback
  add column if not exists screenshot text;

-- The ceiling the client encodes against (screenshot.js walks quality down
-- until it fits, and sends nothing rather than overflow). It is here because
-- the client is not the only thing that can POST with a publishable key: this
-- is what stops a hand-rolled insert from parking megabytes in the table. The
-- message column has no such bound, which is the older gap, not a new one.
alter table public.feedback drop constraint if exists feedback_screenshot_size;
alter table public.feedback
  add constraint feedback_screenshot_size
  check (screenshot is null or length(screenshot) <= 400000);

-- Which feedback is still to deal with. Without it the only way to tell was to
-- remember which dates had been read; `scripts/feedback.mjs` reads and writes
-- this column. The alter is what reaches a database the create table skipped.
alter table public.feedback
  add column if not exists status text not null default 'new';

alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback
  add constraint feedback_status_check check (status in ('new', 'done'));

-- The listing reads the pending ones, newest first, and nothing else.
create index if not exists feedback_status_new_idx
  on public.feedback (created_at desc)
  where status = 'new';

-- RLS: the anon role may only INSERT. No select/update/delete — feedback is
-- read out-of-band (SQL / admin), never exposed back to the client.
alter table public.feedback enable row level security;

drop policy if exists feedback_anon_insert on public.feedback;
create policy feedback_anon_insert
  on public.feedback
  for insert
  to anon
  -- The column has a default, so the app never sends it; spelling it out here
  -- stops a hand-rolled POST from filing feedback pre-marked as dealt with.
  with check (status = 'new');

create or replace function public.notify_new_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  api_key   text;
  from_addr text := 'Arabesque <onboarding@resend.dev>';  -- test mode; switch to feedback@<domain> once verified in Resend
  to_addr   text := 'ivan.schneider@hey.com';
  excerpt   text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
   where name = 'resend_api_key';

  if api_key is null then
    raise warning 'notify_new_feedback: secret "resend_api_key" missing from Vault — email not sent';
    return new;
  end if;

  -- Minimal HTML escaping (message is user-entered) then line breaks.
  excerpt := left(new.message, 4000);
  excerpt := replace(excerpt, '&', '&amp;');
  excerpt := replace(excerpt, '<', '&lt;');
  excerpt := replace(excerpt, '>', '&gt;');
  excerpt := replace(excerpt, E'\n', '<br>');

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', from_addr,
      'to', jsonb_build_array(to_addr),
      'reply_to', coalesce(nullif(new.email, ''), to_addr),  -- reply = reply to the user
      'subject', 'New Piano Trainer feedback' || coalesce(' [' || new.category || ']', ''),
      'html', format(
        '<p><strong>New feedback</strong>%s</p>'
        '<blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#333">%s</blockquote>'
        '<p style="color:#666">— %s</p>%s'
        '<p style="color:#999;font-size:13px">id <code>%s</code></p>',
        coalesce(' · ' || new.category, ''),
        excerpt,
        coalesce(nullif(new.email, ''), 'anonymous'),
        -- The image is too big to inline in the notification; say it exists and
        -- how to look at it, or it never gets looked at.
        case when new.screenshot is null then ''
             else '<p style="color:#666">📷 Screenshot attached — <code>node scripts/feedback.mjs shot ' ||
                  left(new.id::text, 8) || '</code></p>'
        end,
        new.id
      )
    )
  );

  return new;
end;
$$;

drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify
  after insert on public.feedback
  for each row execute function public.notify_new_feedback();
