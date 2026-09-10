import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAuthMd, mailerDrift, REQUIRED, SUBJECT_KEYS, TEMPLATE_KEYS, AUTH_MD } from '../../scripts/lib/authConfig.mjs'

// supabase/auth.md is the canonical record of the hosted Supabase auth config,
// applied by scripts/apply-auth-config.mjs. Nothing in CI can (or should) reach
// the project — the token opens the whole Supabase account — but the file's own
// invariants, and the places the repo repeats one of its values, are worth
// catching when they change rather than when someone next runs the applier.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

describe('supabase/auth.md', () => {
  it('parses, and declares exactly the settings the applier sends', () => {
    const { settings } = parseAuthMd()
    expect(Object.keys(settings).sort()).toEqual([...REQUIRED].sort())
  })

  it('refuses a Template section that leaves one email type out', () => {
    // The App Review rejection of 2026-09-10, as an assertion. signInWithOtp
    // picks the template by whether Supabase has seen the address before, so a
    // code in magic_link alone reaches everyone who has already signed in and
    // nobody else — every reviewer is a first-time address. Un-backticking a
    // key is how the file stops naming it.
    const md = readFileSync(AUTH_MD, 'utf8')
    for (const key of [...SUBJECT_KEYS, ...TEMPLATE_KEYS]) {
      expect(() => parseAuthMd(md.replace(`\`${key}\``, key))).toThrow(key)
    }
  })

  it('reports an email the project customised and this file does not name', () => {
    // The other half of the same hole: the applier's diff can only see keys
    // auth.md names, so the closure check reads Supabase's own record of what
    // has been customised. No token needed — the shape is all that matters.
    const declared = (keys) => Object.fromEntries(keys.map((k) => [k.toUpperCase(), true]))
    const live = {
      mailer_subjects_custom_contents: declared(SUBJECT_KEYS),
      mailer_templates_custom_contents: declared(TEMPLATE_KEYS),
    }
    expect(mailerDrift(live)).toEqual([])

    live.mailer_templates_custom_contents.MAILER_TEMPLATES_RECOVERY_CONTENT = true
    delete live.mailer_subjects_custom_contents.MAILER_SUBJECTS_CONFIRMATION
    expect(mailerDrift(live)).toEqual([
      'mailer_subjects_confirmation is back at Supabase\'s default',
      'mailer_templates_recovery_content is customised in the project but not in auth.md',
    ])
  })

  it('carries a code and never a link', () => {
    // The whole point of the sign-in flow: a link signs in whichever browser
    // opens it, which on iOS is Safari and not the app's webview.
    const { template } = parseAuthMd()
    expect(template).toContain('{{ .Token }}')
    expect(template).not.toContain('ConfirmationURL')
  })

  it('promises the code length and lifetime the UI states', () => {
    const { settings } = parseAuthMd()
    const fr = read('public/js/locales/fr.js')
    expect(fr).toContain(`Code à ${settings.mailer_otp_length} chiffres`)
    expect(Number(settings.mailer_otp_exp)).toBe(3600) // "valable une heure"
  })

  it('sends from the same address as the feedback notification', () => {
    // Two independent places name the sender: this file, applied through the
    // Management API, and the trigger function in supabase/feedback.sql,
    // applied by hand to the database. They drifted apart once already.
    const { settings } = parseAuthMd()
    const sql = read('supabase/feedback.sql')
    expect(sql).toContain(`<${settings.smtp_admin_email}>`)
  })

  it('does not hand the reader a runnable PATCH', () => {
    // The outage this file documents was a hand-written PATCH naming two
    // fields of a group. Prose may discuss that; a copy-pasteable command
    // must not live here again, so only fenced blocks are checked.
    const md = readFileSync(AUTH_MD, 'utf8')
    const blocks = [...md.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)].map((m) => m[1])
    const runnable = blocks.filter((b) => /-X\s*PATCH|--request\s+PATCH/.test(b))
    expect(runnable).toEqual([])
  })
})
