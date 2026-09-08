import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAuthMd, REQUIRED, AUTH_MD } from '../../scripts/lib/authConfig.mjs'

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
