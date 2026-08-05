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
-- Debugging deliveries (pg_net logs responses):
--   select status_code, content from net._http_response order by created desc limit 5;

create extension if not exists pg_net with schema extensions;

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message    text not null,
  email      text,
  category   text,          -- 'bug' | 'idea' | 'score' | 'other' (free text; UI-constrained)
  context    jsonb          -- app_version, locale, user_agent, viewport, anonymized stats
);

-- RLS: the anon role may only INSERT. No select/update/delete — feedback is
-- read out-of-band (SQL / admin), never exposed back to the client.
alter table public.feedback enable row level security;

drop policy if exists feedback_anon_insert on public.feedback;
create policy feedback_anon_insert
  on public.feedback
  for insert
  to anon
  with check (true);

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
        '<p style="color:#666">— %s</p>'
        '<p style="color:#999;font-size:13px">id <code>%s</code></p>',
        coalesce(' · ' || new.category, ''),
        excerpt,
        coalesce(nullif(new.email, ''), 'anonymous'),
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
