// A generated line written into a checked-in file, in place of the marker that
// stands there in the repository — how stamp-version.mjs writes the build
// version and the precache list, and how changelog.mjs writes the pending
// entries. Exactly one match is the whole point: a marker that has drifted or
// been duplicated must stop the deploy, loudly, rather than silently ship a
// file with the old value still in it.
import { readFileSync, writeFileSync } from 'node:fs'

export function replaceOnce(file, pattern, replacement) {
  const before = readFileSync(file, 'utf8')
  const count = (before.match(new RegExp(pattern.source, pattern.flags + 'g')) ?? []).length
  if (count !== 1) {
    console.error(`${file}: expected exactly one ${pattern}, found ${count}`)
    process.exit(1)
  }
  writeFileSync(file, before.replace(pattern, replacement))
}
