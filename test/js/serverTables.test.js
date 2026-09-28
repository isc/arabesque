import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// What happens to a player's rows on the server is written table by table in
// the DDL (supabase/*.sql, the canonical record: there is no migration
// system), and a table added later is one it is easy to leave out of. Read
// offline from those files, like authConfig.test.js.
const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase')
const sql = readdirSync(SUPABASE)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(join(SUPABASE, file), 'utf8'))
  .join('\n')

// Each table's columns, with the rest of the line that defines each: from its
// create statement, and the columns added to it since.
const tables = new Map()
for (const [, table, body] of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  tables.set(table, new Map([...body.matchAll(/^\s+(\w+)\s+(.*)$/gm)].map(([, column, rest]) => [column, rest])))
}
for (const [, table, column, rest] of sql.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+)\s+(.*)/g)) {
  tables.get(table)?.set(column, rest)
}

const tablesWith = (column) => [...tables].filter(([, columns]) => columns.has(column)).map(([table]) => table).sort()

describe('the server tables', () => {
  // A profile deleted on one device takes its rows off the server with it
  // (drop_profile_rows): a table it forgot would keep them for good.
  it('drop the rows of a deleted profile from every table that files rows by profile', () => {
    const body = sql.match(/function public\.drop_profile_rows\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)[1]
    const dropped = [...body.matchAll(/delete from public\.(\w+)/g)].map(([, table]) => table).sort()

    expect(tablesWith('profile_id')).not.toHaveLength(0)
    expect(dropped).toEqual(tablesWith('profile_id'))
  })

  // Deleting an account is one delete from auth.users (account.sql), which
  // reaches the player's rows only through the cascade.
  it('go with the account from every table that files rows by player', () => {
    expect(tablesWith('user_id')).not.toHaveLength(0)
    for (const table of tablesWith('user_id')) {
      expect(tables.get(table).get('user_id'), table).toMatch(/^uuid not null references auth\.users \(id\) on delete cascade/)
    }
  })
})
