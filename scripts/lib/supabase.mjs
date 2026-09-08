// Shared access to the Arabesque Supabase project's Management API.
//
// Both scripts that talk to it — scripts/feedback.mjs (reads the feedback
// table) and scripts/apply-auth-config.mjs (applies supabase/auth.md) — go
// through here, so the token lookup and the API's error shape are handled in
// exactly one place.
//
// ⚠ The token is account-wide, not project-scoped: never print it, never copy
// it anywhere else. See ~/.claude/SUPABASE.md.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROJECT_REF = 'mtihhulokbhhvkomlmmk'
const TOKEN_PATH = join(homedir(), '.supabase', 'access-token')

export function die(message) {
  console.error(message)
  process.exit(1)
}

let cachedToken
export function token() {
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

// Every request goes through here, so the API's error shape is turned into a
// message worth reading in exactly one place.
export async function api(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) die(`Supabase API ${res.status}: ${body?.message ?? JSON.stringify(body)}`)
  return body
}

export const query = (sql) => api('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) })
