// Build the backup the capture seeds the app with, from the practice history
// cloud sync keeps on Supabase — so the video can be regenerated from any
// checkout, not only from the machine whose browser holds the data.
//
//   node capture/fetch-backup.mjs [--email <account>] [--profile <id>]
//
// Writes capture/.work/backup.json (gitignored: it is someone's real practice
// history), in the shape the app's own "Exporter sauvegarde" produces. Reads go
// through the Management API with the token scripts/lib/supabase.mjs finds
// (~/.supabase/access-token or $SUPABASE_ACCESS_TOKEN).
//
// Without --email, the account with the most sessions on that profile is used.
// Aggregates are left out: Supabase does not store them, and build-assets.mjs
// rebuilds them from the sessions after the import, the way sync does.
import fs from 'fs'
import { parseArgs } from 'node:util'
import { die, query } from '../../scripts/lib/supabase.mjs'
import { BACKUP_PATH, WORKDIR } from './lib.mjs'

const { values } = parseArgs({
  options: { email: { type: 'string' }, profile: { type: 'string', default: 'main' } },
})

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
const profile = quote(values.profile)

const [owner] = await query(`
  select u.id, u.email, count(*)::int as sessions
    from public.training_sessions s join auth.users u on u.id = s.user_id
   where s.profile_id = ${profile} ${values.email ? `and u.email = ${quote(values.email)}` : ''}
   group by 1, 2 order by sessions desc limit 1
`)
if (!owner) die(`no sessions for ${values.email ?? 'any account'} on profile ${values.profile}`)

const user = quote(owner.id)
const sessions = await query(`
  select data from public.training_sessions
   where user_id = ${user} and profile_id = ${profile} order by ended_at
`)
const fingerings = await query(`
  select score_url, fingerings, updated_at from public.user_fingerings
   where user_id = ${user} and profile_id = ${profile}
`)

fs.mkdirSync(WORKDIR, { recursive: true })
fs.writeFileSync(
  BACKUP_PATH,
  JSON.stringify({
    exportDate: new Date().toISOString(),
    sessions: sessions.map((r) => r.data),
    aggregates: [],
    fingerings: fingerings.map((r) => ({ scoreUrl: r.score_url, fingerings: r.fingerings, updatedAt: Number(r.updated_at) })),
  })
)
console.log(`${owner.email} / ${values.profile}: ${sessions.length} sessions, ${fingerings.length} fingerings → ${BACKUP_PATH}`)
