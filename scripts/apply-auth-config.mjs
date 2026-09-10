#!/usr/bin/env node
// Applies supabase/auth.md — the canonical record of the project's auth
// settings — to the hosted Supabase project, or reports how the two differ.
//
//   node scripts/apply-auth-config.mjs          # diff only, changes nothing
//   node scripts/apply-auth-config.mjs --apply  # push auth.md to the project
//
// Why this exists rather than a curl in a doc: the Management API groups the
// auth settings, and a PATCH naming one member of a group silently clears the
// others. Sending smtp_admin_email on its own once wiped the whole SMTP block
// *and* reset the email template to Supabase's default, putting the magic link
// back into production. This script only ever sends a group whole, reads the
// result back, and checks that nothing outside the groups moved.
//
// The parsing and its checks live in scripts/lib/authConfig.mjs, so the same
// invariants are asserted offline by test/js/authConfig.test.js.
//
// The SMTP password is a Resend API key and is never in the repo: it is read
// from Supabase Vault (`resend_api_key`) at apply time, and never printed.
import { parseArgs } from 'node:util'
import { api, die, query } from './lib/supabase.mjs'
import { NUMERIC, mailerDrift, parseAuthMd } from './lib/authConfig.mjs'

const CONFIG = '/config/auth'

// A mistyped flag is refused rather than silently running the wrong mode.
let values
try {
  ;({ values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } }))
} catch (error) {
  die(error.message)
}

let want
try {
  ;({ want } = parseAuthMd())
} catch (error) {
  die(error.message)
}

// --- how the project differs ------------------------------------------------

const liveValue = (live, key) => String(live[key] ?? '').trim()

function report(live) {
  let drifted = 0
  for (const [key, expected] of Object.entries(want)) {
    const got = liveValue(live, key)
    if (expected === got) {
      console.log(`  ok   ${key}`)
      continue
    }
    drifted++
    console.log(` DRIFT ${key}`)
    // For multi-line values, the first differing line is what you need to see;
    // truncating from the start prints two identical-looking openings.
    const w = expected.split('\n')
    const g = got.split('\n')
    const at = w.findIndex((line, i) => line !== g[i])
    const trim = (s = '') => (s.length > 60 ? s.slice(0, 57) + '…' : s)
    const where = w.length > 1 ? ` (line ${at + 1})` : ''
    console.log(`        auth.md${where}: ${trim(w[at] ?? '')}`)
    console.log(`        project${where}: ${trim(g[at] ?? '')}`)
  }
  console.log(live.smtp_pass ? '  ok   smtp_pass (set, from Vault)' : ' DRIFT smtp_pass (missing)')
  for (const line of mailerDrift(live)) {
    drifted++
    console.log(` DRIFT ${line}`)
  }
  return drifted
}

const live = await api(CONFIG)
const drifted = report(live)

if (!values.apply) {
  console.log(`\n${drifted} setting(s) differ. Re-run with --apply to push auth.md.`)
  process.exit(drifted ? 1 : 0)
}

// --- apply, each group whole ------------------------------------------------

const [{ decrypted_secret: smtpPass } = {}] = await query(
  "select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key'",
)
if (!smtpPass) die('No resend_api_key in Supabase Vault — refusing to apply and blank the SMTP password.')

const payload = { ...want, smtp_pass: smtpPass }
for (const k of NUMERIC) payload[k] = Number(payload[k])

await api(CONFIG, { method: 'PATCH', body: JSON.stringify(payload) })

const after = await api(CONFIG)

const bad = Object.entries(want).filter(([key, expected]) => liveValue(after, key) !== expected)

// The lesson of the outage is that a PATCH clears fields nobody named — so the
// groups in authConfig.mjs are a guess, learned from one incident. Rather than
// trust it, compare the whole config either side of the write: anything that
// moved which we did not ask to move is a grouping not yet discovered.
// smtp_pass is left out because the API never reads it back, and the two
// *_custom_contents maps because they are not settings but Supabase's record of
// which templates we have customised: they move as a consequence of this very
// write. report() checks them head-on instead.
const NOT_COMPARED = ['smtp_pass', 'mailer_subjects_custom_contents', 'mailer_templates_custom_contents']
const asked = new Set([...Object.keys(payload), ...NOT_COMPARED])
const collateral = Object.keys(after).filter(
  (k) => !asked.has(k) && JSON.stringify(after[k]) !== JSON.stringify(live[k]),
)

if (bad.length || collateral.length || !after.smtp_pass) {
  console.log('')
  if (bad.length) console.log(`✗ ${bad.length} setting(s) did not take: ${bad.map(([k]) => k).join(', ')}`)
  if (!after.smtp_pass) console.log('✗ smtp_pass is empty after the write.')
  for (const k of collateral) {
    console.log(`✗ collateral change — the PATCH also moved ${k}:`)
    console.log(`    before: ${JSON.stringify(live[k])}`)
    console.log(`    after : ${JSON.stringify(after[k])}`)
  }
  if (collateral.length) console.log('  Add these to GROUPS and to supabase/auth.md, then re-apply.')
  process.exit(1)
}
console.log('\n✓ Applied; every setting reads back as auth.md declares, and nothing else moved.')
