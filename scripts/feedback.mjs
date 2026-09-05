#!/usr/bin/env node
// scripts/feedback.mjs
//
// Reads and triages the user feedback sent from the app's "Feedback" button.
//
// The anon key the frontend ships can only INSERT (see supabase/feedback.sql),
// so reading happens out of band. Rather than a second set of project
// credentials in the repo, this goes through the Supabase Management API with
// the personal token the CLI already keeps in ~/.supabase/access-token —
// nothing to install, nothing to gitignore.
//
//   node scripts/feedback.mjs list                 # pending only (status 'new')
//   node scripts/feedback.mjs list --all           # dealt-with ones too
//   node scripts/feedback.mjs list --limit 100     # default 50
//   node scripts/feedback.mjs show <id>            # one entry, full context
//   node scripts/feedback.mjs shot <id> [--out p]  # write its screenshot to a file
//   node scripts/feedback.mjs treat <id> [<id>…]   # mark as dealt with
//   node scripts/feedback.mjs treat --all          # every pending one
//   node scripts/feedback.mjs untreat <id>         # put one back in the list
//
// An <id> is the 8-character prefix the listing shows; a prefix matching more
// than one entry is refused rather than guessed at.
//
// ⚠ That token is account-wide, not project-scoped: never print it, never copy
// it anywhere else. See ~/.claude/SUPABASE.md.
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const PROJECT_REF = 'mtihhulokbhhvkomlmmk'
const TOKEN_PATH = join(homedir(), '.supabase', 'access-token')
const ID_PREFIX = /^[0-9a-f]{4,36}$/i // uuid, or enough of its start to be useful

let cachedToken
function token() {
  if (cachedToken) return cachedToken
  cachedToken = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (cachedToken) return cachedToken
  try {
    cachedToken = readFileSync(TOKEN_PATH, 'utf8').trim()
  } catch {
    die(
      `no Supabase token in $SUPABASE_ACCESS_TOKEN nor at ${TOKEN_PATH}\n` +
        'Create one at https://supabase.com/dashboard/account/tokens, then:\n' +
        `  install -m 600 /dev/null ${TOKEN_PATH} && $EDITOR ${TOKEN_PATH}`,
    )
  }
  return cachedToken
}

function die(message) {
  console.error(message)
  process.exit(1)
}

// Every statement goes through here, so the API's error shape is turned into a
// message worth reading in exactly one place.
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) die(`Supabase API ${res.status}: ${body?.message ?? JSON.stringify(body)}`)
  return body
}

// The API takes SQL as a string, so anything interpolated is quoted here. Only
// ever used for id prefixes, which are checked against ID_PREFIX first — belt
// and braces, since one of these ends up inside a LIKE pattern.
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function short(id) {
  return id.slice(0, 8)
}

function ago(days) {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

async function list({ all, limit }) {
  const rows = await query(`
    select id, to_char(created_at, 'YYYY-MM-DD HH24:MI') as at,
           extract(day from now() - created_at)::int as age_days,
           category, email, message, status,
           -- Never the value itself: a few hundred kB of base64 per row would
           -- swamp both the response and the terminal. "shot" fetches one.
           screenshot is not null as has_shot,
           context->>'score' as score, context->>'app_version' as app_version
      from public.feedback
     ${all ? '' : "where status = 'new'"}
     order by created_at desc
     limit ${Number(limit)}
  `)

  if (rows.length === 0) {
    console.log(all ? 'No feedback at all.' : 'Nothing pending. 🎉')
    return
  }

  for (const row of rows) {
    const tags = [row.category, row.score, row.app_version, row.has_shot && '📷 shot'].filter(Boolean).join(' · ')
    const status = row.status === 'done' ? ' ✓' : ''
    console.log(
      `\n\x1b[1m${short(row.id)}\x1b[0m${status}  ${row.at} (${ago(row.age_days)})` +
        `  ${row.email ?? 'anonymous'}${tags ? `\n         ${tags}` : ''}`,
    )
    for (const line of row.message.split('\n')) console.log(`  ${line}`)
  }

  const pending = rows.filter((r) => r.status === 'new').length
  console.log(all ? `\n${rows.length} shown, ${pending} pending.` : `\n${pending} pending.`)
}

async function show(prefix) {
  const [id] = await resolve([prefix])
  const [row] = await query(`select * from public.feedback where id = ${quote(id)}`)
  // Still "full context": the wildcard keeps showing columns added later. Only
  // the screenshot is held back, and here rather than in the SQL — printing a
  // few hundred kB of base64 would bury the entry it belongs to.
  const { screenshot, ...rest } = row
  console.log(JSON.stringify(rest, null, 2))
  if (screenshot) console.log(`\n📷 ${Math.round(screenshot.length / 1024)} kB — feedback.mjs shot ${short(id)}`)
}

// The screenshot, written where an image viewer can open it. Stored as a data
// URL, so the mime type in it also picks the extension.
async function shot(prefix, out) {
  const [id] = await resolve([prefix])
  const [row] = await query(`select screenshot from public.feedback where id = ${quote(id)}`)
  if (!row.screenshot) die(`Feedback ${short(id)} has no screenshot.`)

  const match = /^data:image\/(\w+);base64,(.*)$/s.exec(row.screenshot)
  if (!match) die('Stored screenshot is not a base64 image data URL.')
  const [, format, base64] = match

  const path = out ?? join(tmpdir(), `feedback-${short(id)}.${format}`)
  writeFileSync(path, Buffer.from(base64, 'base64'))
  console.log(path)
}

// Resolving prefixes is what makes the short ids in the listing usable. An
// ambiguous one is an error, never a coin toss: marking the wrong feedback as
// dealt with hides it from the only listing that would have shown the mistake.
async function resolve(prefixes, status) {
  for (const prefix of prefixes) if (!ID_PREFIX.test(prefix)) die(`Not an id: ${prefix}`)

  const candidates = await query(`
    select id, left(message, 60) as message from public.feedback
     where ${status ? `status = ${quote(status)} and` : ''}
           (${prefixes.map((p) => `id::text like ${quote(`${p}%`)}`).join(' or ')})
  `)

  const of = status ? `${status} feedback` : 'feedback'
  return prefixes.map((prefix) => {
    const matches = candidates.filter((c) => c.id.startsWith(prefix))
    if (matches.length === 0) die(`No ${of} whose id starts with ${prefix}.`)
    if (matches.length > 1) {
      die(
        `${prefix} matches ${matches.length} entries — use more characters:\n` +
          matches.map((m) => `  ${short(m.id)}  ${m.message}`).join('\n'),
      )
    }
    return matches[0].id
  })
}

async function setStatus(prefixes, { to, from, all }) {
  if (!all && prefixes.length === 0) die('Which one? Pass an id from `list`, or --all.')

  const where = all
    ? `status = ${quote(from)}`
    : `id in (${(await resolve(prefixes, from)).map(quote).join(', ')})`

  const rows = await query(`
    update public.feedback set status = ${quote(to)}
     where ${where}
     returning id, left(message, 60) as message
  `)
  if (rows.length === 0) {
    console.log('Nothing to change.')
    return
  }
  for (const row of rows) console.log(`${to === 'done' ? '✓' : '↩'} ${short(row.id)}  ${row.message}`)
}

// A mistyped flag is refused rather than silently ignored — but as one line,
// not as a stack trace.
let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean' },
      limit: { type: 'string', default: '50' },
      out: { type: 'string' },
    },
  })
} catch (error) {
  die(error.message)
}
const { values, positionals } = parsed
const [command = 'list', ...ids] = positionals

switch (command) {
  case 'list': {
    const limit = Number(values.limit)
    if (!Number.isInteger(limit) || limit < 1) die('--limit takes a positive whole number.')
    await list({ all: values.all, limit })
    break
  }
  case 'show':
    if (!ids[0]) die('Usage: feedback.mjs show <id>')
    await show(ids[0])
    break
  case 'shot':
    if (!ids[0]) die('Usage: feedback.mjs shot <id> [--out path]')
    await shot(ids[0], values.out)
    break
  case 'treat':
    await setStatus(ids, { to: 'done', from: 'new', all: values.all })
    break
  case 'untreat':
    await setStatus(ids, { to: 'new', from: 'done', all: values.all })
    break
  default:
    die(`Unknown command "${command}". Try: list | show <id> | shot <id> | treat <id…> | untreat <id…>`)
}
