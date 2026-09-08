// Reads supabase/auth.md — the canonical record of the project's Supabase auth
// settings — into the values the Management API takes.
//
// Split out of scripts/apply-auth-config.mjs so the same parse can be asserted
// by test/js/authConfig.test.js without touching the network: the script is the
// only thing that writes, but the invariants it depends on are worth catching
// when the file changes, not when someone next runs the applier.
//
// Every read is checked. The file is prose, and a careless edit to prose must
// not be able to ship a partial group — that is what caused the 2026-09-08
// outage. Anything unexpected throws.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUTH_MD = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'supabase', 'auth.md')

// The settings the table must declare — no more, no fewer. Grouped as the API
// groups them, because a group is only ever sent whole.
export const GROUPS = {
  smtp: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email', 'smtp_sender_name'],
  mailer: ['mailer_otp_length', 'mailer_otp_exp'],
  limits: ['rate_limit_email_sent'],
}
export const REQUIRED = Object.values(GROUPS).flat()
export const NUMERIC = ['mailer_otp_length', 'mailer_otp_exp', 'rate_limit_email_sent']

// Each block is anchored to the setting name it fills, so rewording the prose
// around it is harmless while a stray fenced block elsewhere cannot be picked up
// by accident. Exactly one match, or we stop.
function blockFor(md, key) {
  const matches = [...md.matchAll(new RegExp('`' + key + '`[\\s\\S]*?```[a-z]*\\n([\\s\\S]*?)\\n```', 'g'))]
  if (matches.length !== 1) {
    throw new Error(`supabase/auth.md: expected exactly one fenced block introduced by \`${key}\`, found ${matches.length}.`)
  }
  return matches[0][1].trim()
}

export function parseAuthMd(md = readFileSync(AUTH_MD, 'utf8')) {
  // Scoped to the "## Settings" section: another table elsewhere in the file (a
  // post-mortem, a before/after) must not be read as live configuration.
  const section = md.split(/^## /m).find((s) => s.startsWith('Settings'))
  if (!section) throw new Error('supabase/auth.md has no "## Settings" section.')

  const settings = {}
  for (const [, key, value] of section.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
    if (key in settings) throw new Error(`supabase/auth.md declares \`${key}\` twice in the settings table.`)
    const literal = value.match(/^`([^`]*)`/)
    // A row whose value is not a backticked literal documents something held
    // elsewhere (smtp_pass lives in Vault); it is recorded, not applied.
    if (literal) settings[key] = literal[1]
  }

  const missing = REQUIRED.filter((k) => !(k in settings))
  const unknown = Object.keys(settings).filter((k) => !REQUIRED.includes(k))
  if (missing.length || unknown.length) {
    throw new Error(
      "supabase/auth.md's settings table does not match what the applier applies.\n" +
        (missing.length ? `  missing: ${missing.join(', ')}\n` : '') +
        (unknown.length ? `  unexpected: ${unknown.join(', ')}\n` : '') +
        'Add the key to GROUPS in scripts/lib/authConfig.mjs, or fix the table — never apply a partial group.',
    )
  }
  for (const k of NUMERIC) {
    if (!/^\d+$/.test(settings[k])) throw new Error(`supabase/auth.md: \`${k}\` should be a whole number, got "${settings[k]}".`)
  }

  const subject = blockFor(md, 'mailer_subjects_magic_link')
  const template = blockFor(md, 'mailer_templates_magic_link_content')

  // Positive and negative: the template must be the one that carries a code, and
  // must not be one that carries a link. A negative check alone would only catch
  // the one wrong block we thought of.
  if (!template.includes('{{ .Token }}')) throw new Error('supabase/auth.md: the template has no {{ .Token }}.')
  if (template.includes('ConfirmationURL')) throw new Error('supabase/auth.md: the template carries a magic link.')

  return { settings, subject, template, want: { ...settings, mailer_subjects_magic_link: subject, mailer_templates_magic_link_content: template } }
}
